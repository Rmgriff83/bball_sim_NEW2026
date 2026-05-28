# iOS App Store Submission Plan

## Context

The basketball sim is a Vue 3 + Vite SPA backed by a Laravel API on DigitalOcean. It currently ships as a PWA on `bball-sim.com`. The goal is to wrap the existing web app in Capacitor, replace Stripe with In-App Purchase for the iOS build (Apple Guideline 3.1.1 requires IAP for digital goods), add Sign in with Apple (required by Guideline 4.8 because Google/Facebook social login already exist), then ship to TestFlight and the App Store.

**Approach in one line:** Capacitor shell + RevenueCat for StoreKit 2 IAP + Sign in with Apple + dual-mode (web=Stripe, iOS=IAP) Store UI.

**Estimated wall-clock:** 4–5 weeks, mostly gated by Apple Developer enrollment and IAP work.

The web build at `bball-sim.com` is **unchanged** by this work — Stripe stays, history-mode routing stays.

---

## Current Status (as of branch `prepare-ios-build`)

### Completed (uncommitted on `prepare-ios-build`)

| File | Change |
|------|--------|
| `frontend/capacitor.config.json` | **new** — appId `com.bballsim.app`, in-WebView origin `https://app.bball-sim.com`, `iosScheme: https`, `contentInset: always` |
| `frontend/package.json` | Added `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/preferences`. Added `build:ios` (`vite build && cap sync ios`) and `open:ios` (`cap open ios`) scripts |
| `frontend/src/router/index.js` | Catch-all route `/:pathMatch(.*)*` → redirect to `/` (handles cold-start deep links inside WebView) |
| `frontend/src/main.js` | `navigator.storage.persist()` call on boot (hints iOS to keep IndexedDB campaign cache from being evicted) |
| `frontend/src/composables/useTokenStorage.js` | **new** — async `getToken/setToken/removeToken` backed by Capacitor Preferences (Keychain on iOS, localStorage on web). Includes one-time migration so existing logged-in web users aren't kicked out |
| `frontend/src/composables/useApi.js` | Axios request interceptor now reads token asynchronously via `useTokenStorage`; 401 handler uses `removeToken()` |
| `frontend/src/stores/auth.js` | Token hydrates async in `initialize()`; `login`/`register`/`logout` use `setToken`/`removeToken` |

`npm run build` is green on this branch.

### Not yet done (blocking iOS submission)

All steps from **Phase 1 step 3 onward** in the plan below — i.e. everything that requires Xcode on a Mac.

---

## Resuming on a new Mac

1. Install **Xcode** (full app, Mac App Store — ~10GB download, ~40GB installed). Requires macOS 13.5+.
2. Install Xcode Command Line Tools: `xcode-select --install` (or open Xcode once and accept license).
3. Install **CocoaPods**: `brew install cocoapods`. (Do NOT use `sudo gem install cocoapods` — macOS system Ruby 2.6 is too old for modern CocoaPods/ffi, which needs Ruby ≥ 3.0. Homebrew bundles its own Ruby and avoids the system-gem permission error.)
4. Clone the repo and check out `prepare-ios-build`: `git checkout prepare-ios-build`.
5. `cd frontend && npm install`.
6. Smoke-test the web build first: `npm run dev` → log out, log in, verify the async token flow works.
7. Resume from **Phase 1 step 3** below: `npx cap add ios`.

---

## Phase 0 — Prerequisites (mostly out-of-repo work)

1. **Enroll in Apple Developer Program** ($99/yr at developer.apple.com). Longest pole — start early. Individual is faster than org (org needs D-U-N-S).
2. **App Store Connect**: create app record with bundle ID `com.bballsim.app`, reserve the name, generate an App-Specific Shared Secret (needed for StoreKit receipt validation).
3. **Privacy policy + Terms URLs** live on bball-sim.com — Apple requires them at submission.
4. **Create two Consumable IAPs** in App Store Connect with IDs `tokens_1000` ($0.99) and `tokens_6500` ($4.99). These match the existing bundle IDs in `frontend/src/views/store/StoreView.vue` so the bundle array is reusable as-is.
5. **Create a RevenueCat project** (free tier), attach App Store Connect API key, define an Offering with two Packages mapped to the IAPs above.

---

## Phase 1 — Capacitor shell + routing (1–2 days)

Goal: existing app boots inside an iOS WKWebView with no behavior changes.

1. ~~Install `@capacitor/core` / `cli` / `ios` and run `npx cap init "BBALL SIM" com.bballsim.app --web-dir=dist`.~~ **DONE**
2. ~~Set `server.iosScheme: 'https'` and `server.hostname: 'app.bball-sim.com'` in `capacitor.config.json`.~~ **DONE**
   - **No Cloudflare DNS record needed.** This hostname only exists inside the WebView; the app HTML/JS is bundled in the iOS binary and served locally. iOS never does a DNS lookup. A DNS record + `apple-app-site-association` file is only required later if you want Universal Links (deferrable to v1.1).
3. **`npx cap add ios`** — creates `frontend/ios/` (commit this directory).
4. ~~Catch-all route in router.~~ **DONE**
5. ~~Add `build:ios` + `open:ios` npm scripts.~~ **DONE**
6. **Backend CORS**: add `https://app.bball-sim.com` to the `CORS_ALLOWED_ORIGINS` env on the API host (no edit to `backend/config/cors.php`; it reads from env).
7. ~~Move `auth_token` to Capacitor Preferences / Keychain.~~ **DONE**
8. ~~Add `navigator.storage.persist()` to app boot.~~ **DONE**
9. Smoke test: `npm run build:ios && npm run open:ios` → run on iPhone Simulator. Confirm login, navigation, sync, gameplay all work.

---

## Phase 2 — Icons, splash, Info.plist (half a day)

1. ~~Pre-render a 1024×1024 **opaque** PNG from `frontend/public/app-icon.svg`.~~ **DONE** — source SVG had `rx=80` rounded corners (would rasterize to transparent corners, which Apple rejects). Created `frontend/assets/icon-source.svg` (corners removed → gradient fills full square) and rasterized to `frontend/assets/logo.png` (1024×1024, no alpha) via `sharp`.
2. ~~`npm i -D @capacitor/assets`. Run `npx capacitor-assets generate --ios`.~~ **DONE** — generated AppIcon (single 1024 universal) + light/dark splash (`--splashBackgroundColor '#121214'`) into `frontend/ios/App/App/Assets.xcassets/`.
3. Edit `frontend/ios/App/App/Info.plist`:
   - ~~`NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription`.~~ **N/A** — app uses no device camera/photo library (the "camera"/"photo" code is canvas rendering of courtside photographers; avatars are generated; "uploads" are S3 campaign sync). Adding unused strings can invite reviewer questions, so omitted deliberately.
   - ~~`ITSAppUsesNonExemptEncryption = false`~~ **DONE** (HTTPS only, no custom crypto).
   - `CFBundleURLTypes` entry for Sign in with Apple — deferred to Phase 4.

---

## Phase 3 — IAP migration (THE BIG ONE; 1–2 weeks)

Use **`@revenuecat/purchases-capacitor`** — handles StoreKit 2, sandbox testing, server-side validation via webhook. Avoids writing a custom native plugin.

### 3a. Frontend IAP service

1. `npm i @revenuecat/purchases-capacitor` in `frontend/`. Run `npx cap sync ios`.
2. **New file `frontend/src/services/iap.js`** — exports `initIAP(userId)`, `getOfferings()`, `purchase(productId)`. Set `appUserID` to the authenticated user ID so RevenueCat attributes receipts correctly.

### 3b. Platform-aware Store UI (dual mode — web keeps Stripe)

Edit `frontend/src/views/store/StoreView.vue`:
- Add `import { Capacitor } from '@capacitor/core'` + `const isNative = Capacitor.isNativePlatform()`.
- `confirmPurchase()` branches: native → `iap.purchase(bundle.id)`; web → existing Stripe redirect (unchanged).
- `bundles` array stays as-is; product IDs already match.
- Wrap the Stripe sandbox banner (`isStripeSandbox`) in `v-if="!isNative"`.
- After native purchase success: call `authStore.fetchUser()` to refresh balance (RevenueCat webhook credits server-side).

### 3c. Backend receipt validation

Mirror the existing Stripe webhook pattern in `backend/app/Http/Controllers/PaymentController.php`:

1. New route `POST /api/payments/iap/revenuecat-webhook` in `backend/routes/api.php` (public, secret-auth header).
2. New method `PaymentController::revenueCatWebhook()` — idempotency via new `revenuecat_webhook_events` table, look up user by `app_user_id`, map product ID → token amount via new `config('services.iap.bundles')` array, call `$user->profile->creditTokens($tokens)`.
3. Migration: `create_revenuecat_webhook_events_table` (mirror `stripe_webhook_events`).
4. **Trust model**: token amount comes from server-side config keyed by product ID — never client-supplied. Same pattern as `PaymentController::fulfillCheckoutSession` (the `foreach` over `config('services.stripe.bundles')` that resolves the price ID to a token count).
5. **Defense in depth**: also add `POST /api/payments/iap/verify` — client posts the StoreKit transaction ID right after purchase; server queries Apple's verifyReceipt or RevenueCat REST directly. Handles webhook delays so users aren't left waiting.

---

## Phase 4 — Sign in with Apple (required; ~1 day)

1. `npm i @capacitor-community/apple-sign-in`.
2. Edit `frontend/src/views/auth/LoginView.vue` and `RegisterView.vue`: add native Apple Sign-In button when `Capacitor.isNativePlatform()`. Google + Facebook stay as web-redirect flows (acceptable as long as Apple is offered).
3. New backend endpoint `POST /api/auth/social/apple/native` in `backend/routes/api.php`. Accepts the `identityToken` from Capacitor, verifies against Apple's JWKS, issues a Sanctum token. Add `nativeApple()` to `SocialAuthController` mirroring the existing `callback()` token-issuance pattern.
4. In Xcode: enable "Sign in with Apple" capability on the App target.

---

## Phase 5 — Local storage durability audit

**WKWebView storage in a Capacitor app** differs from Safari:

- localStorage + IndexedDB live in the **app's sandbox container**, not Safari's shared cache.
- Safari's 7-day ITP eviction does **not** apply.
- Storage survives app close, device restart, OS update.
- Wiped only on: app uninstall, severe iOS storage pressure (rare), or user manually clearing in Settings.

**Current localStorage usage in the codebase (full audit):**
- `auth_token` → migrated to Keychain in Phase 1 (done)
- `theme` (`frontend/src/App.vue`, `frontend/src/views/auth/ProfileView.vue`) → fine in localStorage; harmless if lost

**Campaign data lives in IndexedDB** (`frontend/src/engine/db/GameDatabase.js`, `frontend/src/composables/useLocalCache.js`). The `navigator.storage.persist()` call from Phase 1 covers it.

**Defensive follow-up (recommended, ~1 day):**
Verify the existing sync architecture re-hydrates campaigns from MySQL/S3 on a fresh install. Per project conventions, sync is push-only; on first login from a wiped device, the app must pull authoritative campaign state from the backend. If this path doesn't exist or is buggy, add it — backend is the source of truth, local is cache.

Test: install the iOS app, play a game, force-delete the app, reinstall, log in → campaigns must appear. If they don't, fix the backend-pull path before submission.

---

## Phase 6 — Testing the full iOS build

Three test surfaces, in order:

### Simulator (fast iteration)
- Xcode → Run → iPhone 15, iPad. Smoke-test every route, login, lineup management, game sim, store UI.
- **IAP does not work in Simulator** — stub `iap.js` in dev to return success for UI testing.

### Physical device with sandbox IAP
- Plug iPhone in, Xcode → Run on device.
- Create a **Sandbox Tester** Apple ID: App Store Connect → Users and Access → Sandbox Testers.
- Sign out of the App Store on the device; the IAP flow prompts for sandbox creds at purchase time.
- Test matrix: success purchase, cancel mid-flow, network drop mid-purchase, app killed mid-purchase (StoreKit re-delivers on next launch), already-pending transaction on launch, RevenueCat webhook fires and tokens land in DB.

### TestFlight (production code path)
- Xcode → Archive → Distribute → App Store Connect.
- Internal testing: up to 100 testers without external review. Validates real code signing, real IAP sandbox, App Store environment.
- External testing: requires a short Beta App Review (24h). Use for friends/family before public release.

### Backend sync edge case
The 60s sync loop in `sync.js` / `CampaignCacheService.js` may misfire while the app is backgrounded — Capacitor's lifecycle differs from web. Add an App state listener that pauses sync on `appStateChange → !isActive`.

---

## Phase 7 — Submission package (~half a week, plus review)

1. **App Store Connect metadata**: name, subtitle, promo text, description, keywords, support URL, marketing URL, category (Games → Sports / Simulation), age rating (basketball + IAP → likely 4+).
2. **Screenshots**: 6.7" iPhone (1290×2796) and 6.5" (1242×2688), 3–10 each. Capture from Simulator. **Ship iPhone-only first**; add iPad in a follow-up to reduce review surface.
3. **App Privacy nutrition label**: declare email, user ID, purchase history, gameplay data. Linked to identity: yes. Used for tracking: no.
4. **App Review notes**: provide demo credentials for an account with tokens + an in-progress campaign so reviewers can exercise the store and gameplay without grinding.
5. **Export compliance**: `false` for custom encryption (matches Info.plist).
6. Submit → typical review 24–48h. Expect at least one rejection round; common causes for this app: IAP for digital goods (fixed in Phase 3), Apple Sign-In (fixed in Phase 4), unclear demo path (fix with reviewer notes).

---

## Functional changes summary

### Blocking — must ship for v1.0

- ✅ Capacitor packages installed (Phase 1)
- ✅ `capacitor.config.json` configured (Phase 1)
- ✅ Catch-all 404 → `/` redirect (Phase 1)
- ✅ `auth_token` migrated from localStorage to Capacitor Preferences / Keychain (Phase 1)
- ✅ `navigator.storage.persist()` on app boot (Phase 1)
- ✅ `frontend/ios/` Xcode project scaffolded via `cap add ios` (Phase 1) — Capacitor 8 uses Swift Package Manager, not CocoaPods
- ⬜ Backend `CORS_ALLOWED_ORIGINS` env adds `https://app.bball-sim.com` (Phase 1)
- ✅ Icons + splash generated via `@capacitor/assets` from `frontend/assets/`; `ITSAppUsesNonExemptEncryption=false` in Info.plist (Phase 2). Camera/photo usage strings intentionally omitted — app uses no device camera/photo library
- ⬜ `frontend/src/views/store/StoreView.vue` — platform branch for native IAP (Phase 3b)
- ⬜ New `frontend/src/services/iap.js` (Phase 3a)
- ⬜ `backend/app/Http/Controllers/PaymentController.php` — `revenueCatWebhook()` + `verify()` (Phase 3c)
- ⬜ New `revenuecat_webhook_events` migration + `config/services.php` `iap.bundles` (Phase 3c)
- ⬜ `frontend/src/views/auth/LoginView.vue` + `RegisterView.vue` — Apple Sign-In button on native (Phase 4)
- ⬜ `backend/routes/api.php` + `SocialAuthController` — native Apple Sign-In endpoint (Phase 4)
- ⬜ Verify backend-pull campaign rehydration works on fresh install (Phase 5)
- ⬜ Sync pause on app background (Phase 6)

### Deferrable to v1.1

- iPad-specific layouts
- Push notifications
- Universal Links / deep linking (would require Cloudflare DNS record + `apple-app-site-association` file)

---

## Verification — end-to-end success criteria

1. App boots on iPhone Simulator and physical device, loads campaigns, plays a sim game.
2. Sandbox IAP purchase of `tokens_1000` → StoreKit sheet appears → completes → RevenueCat dashboard logs the transaction → `revenuecat_webhook_events` row inserted → user's `tokens` balance increases in MySQL.
3. Apple Sign-In on device returns an `identityToken` → backend verifies it → Sanctum token issued → user lands logged in.
4. TestFlight build installs on a non-developer iPhone and the same flows pass.
5. Web build at `bball-sim.com` is **unchanged** — Stripe still works there.

---

## Critical files reference

- `frontend/src/views/store/StoreView.vue` — Phase 3b dual-mode purchase
- `backend/app/Http/Controllers/PaymentController.php` — Phase 3c webhook + verify
- `frontend/src/router/index.js` — Phase 1 catch-all (done)
- `frontend/src/composables/useApi.js` — Phase 1 async interceptor (done)
- `frontend/src/composables/useTokenStorage.js` — Phase 1 Keychain helper (new, done)
- `frontend/src/stores/auth.js` — Phase 1 async token (done)
- `backend/routes/api.php` — Phase 3c + Phase 4 new endpoints
- `frontend/src/views/auth/LoginView.vue`, `RegisterView.vue` — Phase 4 Apple button
- `frontend/capacitor.config.json` — Phase 1 (new, done)
- New: `frontend/src/services/iap.js` — Phase 3a
- New: `frontend/ios/` — Phase 1 step 3 (Xcode project, will be committed)
