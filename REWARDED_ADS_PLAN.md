# Rewarded Ads Plan (parked — not yet implemented)

Drafted 2026-08-09. Feature: a "Free Tokens" card on the Store page letting
users watch a rewarded ad up to **3×/day for 500 tokens each** (1,500/day cap
so bigger spenders aren't dissuaded from buying tokens).

---

## Expectations (why build it, honestly)

At the current scale (~2k accounts, ~35 daily actives), assume 30–50% of
dailies ever tap the card, averaging 2–3 ads → **~25–50 rewarded
impressions/day**. Small mixed-geo sports-sim inventory earns rewarded-video
eCPMs of roughly **$8–$18** →

- ~35 imps/day × $12 eCPM ≈ $0.40/day ≈ **$12–15/month** (range $5–$30).
- AdMob pays out at a $100 threshold → a payout every ~2–3 quarters.

**This is a retention/economy feature that happens to pay pocket change, not
a revenue line.** It gives non-spenders a daily reason to open the app and a
token path into the badge/upgrade economy, and it scales automatically with
DAU. The 1,500/day cap keeps it a trickle next to store bundles
(cannibalization handled by design).

## Costs & limits

- AdMob is free end-to-end: no SDK fee, no per-request billing, no quotas —
  Google's cut is baked into the eCPM they pay out. Ad-load requests are
  unmetered; ~50/day needs no throttling logic.
- SSV callbacks hit OUR backend (~50 tiny requests/day — negligible).
- The only real "limit" is **fill**: occasionally no ad is available. That's
  a UX case (card fails open / "try again later"), never a billing one.
- Incidentals: a few MB of app size from the SDK; dev/deploy time.

## Ad content & completion behavior

- Rewarded ads are 15–30s videos (sometimes playable/interactive), always
  user-initiated, usually ending on an end-card the user X's out of.
  Tolerable because opt-in; the creative pool is dominated by casual mobile
  games.
- **Competitors can appear by default.** Mitigate via AdMob Blocking
  controls: block specific competitor apps by store URL (cheap), or whole
  sensitive categories like Sports/Simulation Games (costs meaningful
  fill/eCPM). Recommended: start unblocked, watch the Ad Review Center for a
  couple of weeks, then block named rivals surgically.
- **Completion is enforced by Google, not us**: the SDK's "user earned
  reward" event only fires at the ad's reward point (skip/early close → no
  event), and the SSV server callback only arrives for legitimate
  completions. Client-side watch-time tracking is not needed.

---

## Build plan

### Client (native-only; the card never renders on web)
1. **SDK**: `@capacitor-community/admob` (iOS + Android). Init on app start
   (native only, after UMP consent). One REWARDED ad unit per platform.
2. **Store page card** (`frontend/src/views/store/StoreView.vue`): "Free
   Tokens" element — Watch Ad button, "X of 3 left today", 500-token reward
   copy; disabled/hidden when exhausted or no fill (fail-open, never blocks
   the page).
3. **Ad service** (`frontend/src/services/rewardedAds.js`, mirroring
   `services/iap.js` conventions): load → show → on the earned-reward event
   call the backend claim/refresh; retry & cooldown handling. Never credit
   from the client event alone.

### Backend (Laravel)
4. **Claim endpoint** `POST /api/user/ad-reward`: server-enforced 3/day
   (counter + date in the existing `profile.rewards` JSON — the no-migration
   `gmLevel` pattern), crediting 500 via the atomic `creditTokens` path
   (well under the 5k per-call cap). Returns new balance + remaining count.
   Decide counter reset boundary (UTC midnight vs user-local).
5. **Integrity — do this from day one**: AdMob **Server-Side Verification**.
   Set the SSV callback URL on the ad unit; backend verifies Google's
   signature and only then credits. Without SSV a spoofed client mints
   1,500 tokens/day. Only decrement the daily count on an EARNED reward
   (abandoned ads don't burn an attempt).

### Store / platform settings
6. **AdMob**: account + both app registrations, rewarded ad units, link the
   Play/ASC apps, and **app-ads.txt** on bball-sim.com (WordPress root; one
   line from AdMob, crawled within ~24h).
7. **iOS**: `GADApplicationIdentifier` + SKAdNetwork ID list in Info.plist.
   Personalized ads require the ATT prompt (`NSUserTrackingUsageDescription`);
   **simplest compliant start: non-personalized only, no ATT.** Update the
   App Privacy questionnaire in App Store Connect (AdMob SDK data
   disclosures apply even for NPA).
8. **Android**: Play Console **Data safety** form update (AdMob SDK
   disclosures; AD_ID permission arrives via the SDK manifest) + flip the
   "Contains ads" listing declaration (Apple has an equivalent).
9. **Consent**: Google **UMP** flow for EEA/UK before first ad load; NPA
   fallback.
10. Expect a slightly longer store review on the first ads-bearing
    submission (rewarded-ads-for-virtual-currency is standard and allowed on
    both stores).

### Rollout order (each step independently deployable)
1. AdMob account + ad units + app-ads.txt (zero code, can start anytime).
2. Backend endpoint + SSV callback (inert until the client ships).
3. Client SDK + Store card (fail-open if ads unavailable or backend old).
4. Listing declarations + privacy forms with the release that ships it.

### Verification checklist (when built)
- AdMob TEST ad units on dev builds.
- 4th claim of the day rejected server-side; counter resets at the chosen
  boundary.
- Credit only via the SSV-signed path; client-spoofed claim rejected.
- Abandoned ad: no credit, no attempt consumed.
- Card hidden on web; fail-open on no-fill.
- UMP consent flow verified on an EEA-region device.
- Both privacy forms submitted before release.
