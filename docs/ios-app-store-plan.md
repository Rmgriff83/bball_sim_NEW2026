# iOS App Store Submission Plan

## Context

The basketball sim is a Vue 3 + Vite SPA backed by a Laravel API on DigitalOcean. It currently ships as a PWA on `bball-sim.com`. The goal is to wrap the existing web app in Capacitor and replace Stripe with In-App Purchase for the iOS build (Apple Guideline 3.1.1 requires IAP for digital goods), then ship to TestFlight and the App Store. Sign in with Apple (Guideline 4.8) is **not** required for v1.0 because the auth UI exposes no third-party social login — see Phase 4 for details.

**Approach in one line:** Capacitor shell + RevenueCat for StoreKit 2 IAP + dual-mode (web=Stripe, iOS=IAP) Store UI.

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

1. ~~**Enroll in Apple Developer Program** ($99/yr at developer.apple.com).~~ **DONE** (Individual account, name `Rmgriff83` / Ross — see [[app-transfer-strategy]] note in PR description for the post-launch Individual→Organization transfer path).
2. ~~**App Store Connect**: create app record with bundle ID `com.bballsim.app`.~~ **DONE**. Shared Secret was also generated but is **unused** — Apple deprecated it for new apps; RevenueCat (StoreKit 2 / `purchases-capacitor` v5+) uses the **In-App Purchase Key (.p8)** instead. Also generated: an **App Store Connect API Key (.p8)** for product sync.
3. **Privacy policy + Terms URLs** live on bball-sim.com — Apple requires them at submission. Deferred to Phase 7.
4. ~~**Create two Consumable IAPs** in App Store Connect with IDs `tokens_1000` ($0.99) and `tokens_6500` ($4.99).~~ **DONE** — product IDs match `bundles` array in `frontend/src/views/store/StoreView.vue:20-23`.
5. ~~**Create a RevenueCat project** (free tier), attach App Store Connect API key, define an Offering with two Packages mapped to the IAPs above.~~ **DONE** — Offering identifier `default`, Packages `tokens_1000` / `tokens_6500`. Public SDK key (`appl_…`) lives in `VITE_REVENUECAT_API_KEY` (user must add to `frontend/.env.local`). Webhook URL/auth secret to be configured in Phase 3c.

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

### 3a. Frontend IAP service ✅ DONE

1. ~~`npm i @revenuecat/purchases-capacitor` in `frontend/`. Run `npx cap sync ios`.~~ Installed `@revenuecat/purchases-capacitor@13.1.4`.
2. ~~**New file `frontend/src/services/iap.js`**~~ — exports `initIAP(userId)`, `getCurrentOffering()`, `purchase(productId)`, `logoutIAP()`. Uses `VITE_REVENUECAT_API_KEY` (public SDK key) from env. Purchase resolves with `{ success: true, productIdentifier, transactionIdentifier }` on success or `{ cancelled: true }` on user cancel (real errors throw).

### 3b. Platform-aware Store UI (dual mode — web keeps Stripe) ✅ DONE

`frontend/src/views/store/StoreView.vue` edits:
- ~~Imports + `isNative = Capacitor.isNativePlatform()`.~~
- ~~`confirmPurchase()` branches: native → `iap.purchase(bundle.id)` → `authStore.fetchUser()` → toast; web → existing Stripe redirect (unchanged).~~
- ~~`onMounted` calls `iap.initIAP(authStore.user.id)` when native + user present.~~
- ~~Stripe sandbox banner wrapped in `v-if="!isNative && isStripeSandbox"`.~~

### 3c. Backend receipt validation ✅ DONE (verify endpoint deferred)

Mirrors the Stripe webhook pattern in `PaymentController`:

1. ~~Route~~ — `POST /api/webhooks/revenuecat` in `backend/routes/api.php` (public, Authorization-header auth). **NOTE:** path changed from the original `/payments/iap/revenuecat-webhook` to `/webhooks/revenuecat` for consistency with the existing `/webhooks/stripe` convention.
2. ~~`PaymentController::revenueCatWebhook()` + private `fulfillIapPurchase()`~~ — idempotency via the new `revenuecat_webhook_events` table, server-side product→tokens lookup from `config('services.iap.bundles')`, `User::find($app_user_id)->profile->creditTokens(...)`. Triggers on `INITIAL_PURCHASE` and `NON_RENEWING_PURCHASE` events (consumables use the latter).
3. ~~Migration `2026_05_29_213725_create_revenuecat_webhook_events_table`~~ — same shape as `stripe_webhook_events` (`id` PK, `type`, `processed_at`).
4. ~~`config/services.php` `iap.bundles`~~ — `tokens_1000 → 1000`, `tokens_6500 → 6500`.
5. **Defense-in-depth `/verify` endpoint — DEFERRED to v1.1.** RC webhooks usually land in <5s, and the StoreView's post-purchase `fetchUser()` catches the credit. Revisit if observed delays warrant the extra round trip + RC REST secret key.

### Required env vars to wire up

- **`frontend/.env`** → `VITE_REVENUECAT_API_KEY=appl_...` (public SDK key from RC dashboard).
- **`backend/.env`** → `REVENUECAT_WEBHOOK_AUTH=<long-random-string-you-choose>`. Then in RevenueCat dashboard: **Project Settings → Integrations → + New → Webhooks** → URL `https://api.bball-sim.com/api/webhooks/revenuecat` (prod) or your tunneled local URL for sandbox testing, Authorization header value = the same string.

---

## Phase 4 — Sign in with Apple ⏭️ SKIPPED for v1.0

**Why skipped:** Guideline 4.8 only requires Sign in with Apple when the app *offers* a third-party social login in its UI. Audit (2026-05-29) confirmed `LoginView.vue` and `RegisterView.vue` expose **no** Google/Facebook buttons; users can only authenticate via email/password. The backend `SocialAuthController` + `social_accounts` table + `/api/auth/social/{provider}` routes exist as unused scaffolding — they don't trigger 4.8 because they're never invoked from the UI.

**When this becomes required:** the moment any social-login button (Google, Facebook, etc.) is added to `LoginView`/`RegisterView`. At that point come back and do the original Phase 4 steps:

1. `npm i @capacitor-community/apple-sign-in`.
2. Add native Apple Sign-In button in `LoginView.vue` and `RegisterView.vue` when `Capacitor.isNativePlatform()`.
3. New backend endpoint `POST /api/auth/social/apple/native` — accepts the `identityToken` from Capacitor, verifies against Apple's JWKS, issues a Sanctum token. Add `nativeApple()` to `SocialAuthController` mirroring the existing `callback()` token-issuance pattern.
4. In Xcode: enable "Sign in with Apple" capability on the App target. Also enable the matching capability on the App ID in developer.apple.com (already enabled during Phase 0 Part 1a as a precaution).

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
- ✅ `frontend/src/views/store/StoreView.vue` — platform branch for native IAP (Phase 3b)
- ✅ New `frontend/src/services/iap.js` (Phase 3a)
- ✅ `backend/app/Http/Controllers/PaymentController.php` — `revenueCatWebhook()` (Phase 3c). `verify()` deferred to v1.1.
- ✅ New `revenuecat_webhook_events` migration + `config/services.php` `iap.bundles` (Phase 3c)
- ⏭️ ~~Apple Sign-In button + backend endpoint (Phase 4)~~ — **not required for v1.0** since no social login is exposed in the UI; revisit only if Google/Facebook buttons are added later
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
