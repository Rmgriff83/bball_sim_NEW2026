# Sign in with Apple & Google — setup guide

This app supports one-tap **Sign in with Apple** and **Sign in with Google**.

| Build      | Buttons shown        |
|------------|----------------------|
| Web        | Apple **and** Google |
| iOS        | Apple only (native)  |
| Android    | Google only (later)  |

**How it works:** the client obtains an *identity token* (a JWT) from Apple/Google
and POSTs it to `POST /api/auth/social/token`. The Laravel backend verifies the
token against the provider's public keys (JWKS), checks the `aud`/`iss` claims, then
creates-or-links the user (reusing the existing `social_accounts` table) and returns
a Sanctum token — identical to email/password login.

> Because we verify *identity tokens*, you do **not** need a Google client secret or
> an Apple `.p8` key. Only the public **client ids** are required.

---

## 1. Google Cloud — OAuth client id (web)

1. Google Cloud Console → **APIs & Services → Credentials**.
2. Configure the **OAuth consent screen** (External; add app name, support email,
   logo, the production domain under Authorized domains).
3. **Create Credentials → OAuth client ID → Web application**.
   - **Authorized JavaScript origins:** your web origins, e.g.
     `http://localhost:3000`, `https://app.bball-sim.com`.
   - (No redirect URI needed — Google Identity Services uses the JS origin.)
4. Copy the **Client ID** (looks like `xxxx.apps.googleusercontent.com`).

Set it in:
- **Frontend:** `VITE_GOOGLE_WEB_CLIENT_ID` (`.env.development` / `.env.production`).
- **Backend:** `GOOGLE_WEB_CLIENT_ID` (this is the verified `aud`).

*(Optional, for a future native Android/iOS Google flow: create an additional
"iOS"/"Android" OAuth client and set `GOOGLE_IOS_CLIENT_ID` on the backend so its
`aud` is also accepted.)*

---

## 2. Apple Developer — Sign in with Apple

### 2a. App ID (for the iOS native flow)
1. Apple Developer → **Certificates, IDs & Profiles → Identifiers**.
2. Select the app's App ID (`com.bballsim.app`) → enable the **Sign in with Apple**
   capability → Save.
3. The token `aud` for the native flow is the **bundle id** itself
   (`com.bballsim.app`) — already the default of `APPLE_APP_BUNDLE_ID`.

### 2b. Services ID (for the web flow)
1. Identifiers → **+** → **Services IDs** → create one, e.g. `com.bballsim.web`.
   This identifier is the **`aud`** of web identity tokens.
2. Enable **Sign in with Apple** on it → **Configure**:
   - **Primary App ID:** `com.bballsim.app`.
   - **Domains:** `app.bball-sim.com` (+ `localhost` won't work — for local testing
     use a real https domain or a tunnel; Apple requires a verified domain).
   - **Return URLs:** the page that hosts the button, e.g.
     `https://app.bball-sim.com/login`.

Set it in:
- **Frontend:** `VITE_APPLE_WEB_SERVICES_ID` = `com.bballsim.web`, and
  `VITE_APPLE_WEB_REDIRECT_URI` = the Return URL above.
- **Backend:** `APPLE_WEB_SERVICES_ID` = `com.bballsim.web` (accepted `aud`).

> The `.p8` "Sign in with Apple key" is only needed for the server-side
> authorization-code → token exchange (the redirect flow). Our id-token
> verification flow does **not** use it.

---

## 3. Xcode — add the capability to the iOS app

After `npm run build:ios` (which runs `cap sync ios`):
1. Open `frontend/ios/App/App.xcworkspace` in Xcode.
2. Select the **App** target → **Signing & Capabilities** → **+ Capability** →
   **Sign in with Apple**. This generates `App/App/App.entitlements` with
   `com.apple.developer.applesignin`.
3. Ensure the target's **Bundle Identifier** is `com.bballsim.app` and the team is
   set. Build & run on a device/simulator.

The native plugin is `@capgo/capacitor-social-login` (Capacitor 8 compatible —
its Swift package uses `capacitor-swift-pm` 8.x, matching the app and RevenueCat).
We use only its native **Apple** flow on iOS; it also supports Google natively for
the future Android build. No Info.plist URL-scheme changes are needed for Apple
(only the Sign in with Apple **target capability** above).

> Note: the older `@capacitor-community/apple-sign-in` plugin pins
> `capacitor-swift-pm` to 7.x and is incompatible with this Capacitor 8 project
> (causes an Xcode "Missing package product 'CapApp-SPM'" / version-conflict
> error) — that's why we use capgo instead.

---

## 4. Env var reference

| Value                         | Frontend env (`VITE_*`)        | Backend env              |
|-------------------------------|--------------------------------|--------------------------|
| Google web client id          | `VITE_GOOGLE_WEB_CLIENT_ID`    | `GOOGLE_WEB_CLIENT_ID`   |
| Google iOS client id (opt.)   | —                              | `GOOGLE_IOS_CLIENT_ID`   |
| Apple Services ID (web `aud`) | `VITE_APPLE_WEB_SERVICES_ID`   | `APPLE_WEB_SERVICES_ID`  |
| Apple web Return URL          | `VITE_APPLE_WEB_REDIRECT_URI`  | —                        |
| Apple app bundle id (iOS aud) | —                              | `APPLE_APP_BUNDLE_ID`    |

Backend: also run `composer install` (adds `firebase/php-jwt` used for verification).

---

## 5. Testing

- **Web:** set the env vars, `npm run dev`, open `/login`. The Google button (GIS)
  and the Apple button should appear; each signs you in and lands on `/dashboard`.
  Apple web requires a verified https domain (won't work on bare `localhost`).
- **iOS:** `npm run build:ios`, add the capability in Xcode, run on a device → only
  the Apple button shows → native sheet → signed in.
- **Backend unit check:** `php artisan test --filter=SocialAuth`.

> **Deploy note:** the iOS app built with `npm run build:ios` targets the
> **production** API (`.env.production`). The `POST /api/auth/social/token` route
> must be deployed to that backend (run `composer install` and, if you cache
> routes, `php artisan route:clear && php artisan route:cache`) or you'll get
> *"The POST method is not supported … Supported methods: GET, HEAD."*

---

## 6. iOS native plugin & trimming (current: Apple only)

We use `@capgo/capacitor-social-login` (Capacitor 8). On iOS only the **Apple**
provider is used. To keep the binary lean and avoid shipping unused third-party
SDKs, the Facebook and Google SDKs are stripped from the plugin's Swift package via
**patch-package**: `frontend/patches/@capgo+capacitor-social-login+8.3.30.patch`
(reapplied automatically by the `postinstall` script). capgo's `#if canImport(...)`
guards compile those providers down to no-op stubs when the SDKs are absent;
Alamofire is kept because the Apple provider depends on it.

### Re-enabling Google for the future Android build
When you add native Google (Android phase), GoogleSignIn must come back. Either:
- **delete** `frontend/patches/@capgo+capacitor-social-login+8.3.30.patch` and run
  `npm install` (restores capgo's full provider set), or
- edit the patch to drop only the Facebook packages, keeping `GoogleSignIn-iOS`.

Then add the Google provider branch to `frontend/src/services/socialAuth.js` and set
`GOOGLE_IOS_CLIENT_ID` / an Android client id on the backend so those tokens'
`aud` is accepted by `SocialTokenVerifier`.
