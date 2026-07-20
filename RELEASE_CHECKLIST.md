# Release Checklist

Reference this every time we ship a new release. Work top to bottom. The files
themselves are the source of truth for current values — the numbers quoted here
are just "as of last edit" snapshots.

> ⚠️ **Two easy-to-forget bumps:** (1) the **Android `versionCode`** must
> increment on every store upload, and (2) the **backend update-nag config**
> (`backend/config/appversion.php` / env) must be bumped to the new build
> number or the in-app "update available" prompt will never fire. See steps 2
> and 4.

---

## 0. Pre-flight

- [ ] All intended changes merged and the app builds clean:
      `cd frontend && npm run build` (this runs `prebuild`: headshot sync +
      `npm run audit:gameplay`; the build fails on gameplay-wiring drift).
- [ ] Sanity-check that nothing breaks existing saved campaigns (live prod,
      500+ users on-device IndexedDB — see `CLAUDE.md`).
- [ ] Draft the store "What's new" notes. **Google Play caps this at 500
      characters** — count before pasting.
- [ ] If a release adds/changes a **Capacitor plugin** (e.g. the review nag's
      `@capacitor-community/in-app-review`, added 2026-07): run
      `npx cap sync` and rebuild BOTH native apps — plugin features only work
      in binaries built after the sync (older binaries fall back gracefully).
- [ ] If a release adds a **new IAP product**: deploy the backend catalog
      (`backend/config/services.php` bundle + any env vars, e.g.
      `STRIPE_PRICE_*`) **BEFORE** activating the product in App Store
      Connect / Play / RevenueCat / Stripe. A purchasable product with no
      backend mapping = users charged, fulfillment failing until RC's retry
      window runs out.
- [ ] **Community roster board (added 2026-07)** first release needs:
      the `bballsim://` deep-link scheme ships in the native binaries
      (`Info.plist` CFBundleURLTypes + AndroidManifest intent-filter — run
      `npx cap sync`, rebuild both); backend envs `WEB_APP_URL`
      (= `https://play.bball-sim.com` — the web app moved off the root
      domain, which now hosts the WordPress marketing site) +
      `ROSTER_BUILDS_AWS_BUCKET` (+ optional per-bucket IAM creds) set and
      the S3 bucket created (private, no public ACLs); `php artisan migrate`
      (roster_builds tables + login_handoff_tokens); register a DMCA agent
      and get counsel review before enabling publicly.

---

## 1. Version numbers — bump for EACH platform you're shipping

Build numbers are the monotonic per-platform integers that must change every
release. The marketing/version string (`2.34`) is cosmetic and doesn't have to
change every time.

### Android — `frontend/android/app/build.gradle`
- [ ] **`versionCode`** — increment by 1 (Play REJECTS an upload that reuses a
      versionCode). _As of last edit: `22`._
- [ ] `versionName` — bump if the user-facing version changed (e.g. `2.34` →
      `2.35`). _As of last edit: `"2.35"`._

### iOS — `frontend/ios/App/App.xcodeproj/project.pbxproj`
(Both the Debug and Release configs — there are two of each.)
- [ ] **`CURRENT_PROJECT_VERSION`** — increment (iOS build number). _As of last
      edit: `8`._
- [ ] `MARKETING_VERSION` — bump if the user-facing version changed. _As of last
      edit: `2.35`._

> Note: Android and iOS build numbers are **independent scales** (Android
> versionCode `21` vs iOS build `7`). Don't try to keep them equal.

---

## 2. Backend update-nag config — bump to MATCH the new build numbers

This is what triggers the in-app "update available" nag for users still on old
builds. Powered by `GET /api/app-version` (public) →
`backend/app/Http/Controllers/AppVersionController.php`, reading
`backend/config/appversion.php`.

- [ ] Set the new **latest build numbers**, per platform, to match step 1:
  - `ANDROID_LATEST_BUILD` (env) — or the default in `config/appversion.php`.
  - `IOS_LATEST_BUILD` (env) — or the default in `config/appversion.php`.
- [ ] These must equal the `versionCode` / `CURRENT_PROJECT_VERSION` you just
      built. If they're lower, no one gets nagged; if higher than what's live on
      the store, users get nagged toward a build they can't download yet.

> ⏱️ **Timing:** flip the backend `latestBuild` to the new number **once the new
> build is actually live/rolled out on the store** — not before — so we never
> nag users toward a version that isn't downloadable yet. (Safe approach:
> upload to the stores first, then bump + deploy the backend when the release
> goes live.)

---

## 3. Build the client(s)

Run from `frontend/`. All web/native builds run `prebuild` automatically.

- **Android** (signed AAB for Play):
  - [ ] `npm run release:android`
        (= `build:android` → `cap sync android` → `gradlew bundleRelease`).
  - Output: `frontend/android/app/build/outputs/bundle/release/app-release.aab`.
  - Requires `frontend/android/keystore.properties` (upload keystore; **not**
    committed — see `keystore.properties.example`). Without it the bundle is
    unsigned and Play will reject it.
- **iOS** (archive + upload via Xcode):
  - [ ] `npm run build:ios` (= native web build + `cap sync ios`).
  - [ ] `npm run open:ios` → in Xcode: select a device/Any iOS Device →
        Product ▸ Archive → distribute to App Store Connect.
- **Web / PWA hosting** (Firebase):
  - [ ] Deployed as part of `npm run release` (see below), or on its own with
        `npm run build && firebase deploy --only hosting`.

**Shortcut — full web + Android in one go:** `npm run release`
(= web `build` → `firebase deploy --only hosting` → native build → `cap sync` →
`bundleRelease`). iOS is always separate (archive in Xcode).

---

## 4. Deploy the backend (so the nag config takes effect)

- [ ] Update `ANDROID_LATEST_BUILD` / `IOS_LATEST_BUILD` on the server (env) or
      edit `config/appversion.php`, then rebuild caches:
      `php artisan config:cache` (and `php artisan route:cache` if used).
- [ ] Verify the public endpoint returns the new numbers:
      `curl https://api.bball-sim.com/api/app-version`
      → `{ "android": { "latestBuild": N }, "ios": { "latestBuild": M } }`.

---

## 5. Store submissions

- [ ] **Google Play Console** — upload the AAB, paste the ≤500-char "What's
      new", roll out (staged rollout optional). Update review is usually a few
      hours to ~1–2 days.
- [ ] **App Store Connect** — the archive from Xcode; fill "What's New in This
      Version", submit for review.

---

## 6. Post-release verification

- [ ] On a device still on the **previous** build, cold-start the app → the
      "Update available" nag appears; **Update** opens the correct store; store
      page is the right app.
- [ ] On a device on the **new** build → no nag (running build ≥ latest).
- [ ] Fail-open sanity: the nag never blocks the app; if `/api/app-version` is
      unreachable, nothing shows (by design).
- [ ] Web build unaffected (no nag on web; stale web assets self-heal via the
      router's chunk-reload).

---

## Quick reference — files that change per release

| What | File |
|---|---|
| Android build number (required) | `frontend/android/app/build.gradle` → `versionCode` |
| Android version string | `frontend/android/app/build.gradle` → `versionName` |
| iOS build number (required) | `frontend/ios/App/App.xcodeproj/project.pbxproj` → `CURRENT_PROJECT_VERSION` (×2) |
| iOS version string | `…project.pbxproj` → `MARKETING_VERSION` (×2) |
| **Update-nag latest build (required)** | `backend/config/appversion.php` or env `ANDROID_LATEST_BUILD` / `IOS_LATEST_BUILD` |
| Android signing (must exist locally) | `frontend/android/keystore.properties` |
