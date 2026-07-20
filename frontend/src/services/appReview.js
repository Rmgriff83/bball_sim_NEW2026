// In-app review + feedback plumbing for the one-time review nag. Mirrors
// services/appUpdate.js conventions: native-aware, strictly fail-open — any
// plugin failure degrades to the store-page fallback so the user is never
// stuck on a broken sheet.
import { Capacitor } from '@capacitor/core'
import { STORE_URLS } from '@/services/appUpdate'

/**
 * Ask the OS for the native in-app review sheet.
 *  - Android: Play in-app review (stars + optional written review, in-app).
 *  - iOS: SKStoreReviewController stars sheet. The OS rations it (~3/year)
 *    and may silently not display — callers should offer the write-review
 *    deep link as a companion path, not rely on this alone.
 * @returns {Promise<boolean>} true when the plugin call succeeded (which on
 *   iOS still doesn't guarantee the sheet was displayed); false on web or
 *   any failure — caller falls back to the store page.
 */
export async function requestInAppReview() {
  try {
    if (!Capacitor.isNativePlatform()) return false
    // Dynamic import: keeps web bundles happy and tolerates a binary that
    // predates the plugin (older installs simply fall back to the store link).
    const { InAppReview } = await import('@capacitor-community/in-app-review')
    await InAppReview.requestReview()
    return true
  } catch {
    return false
  }
}

/**
 * The store's write-review destination for this platform. iOS's
 * `?action=write-review` opens the App Store composer (stars + written review
 * in one screen); Android's Play listing carries the review widget. Web
 * defaults to the iOS page (the more common storefront link).
 */
export function writeReviewUrl() {
  const platform = Capacitor.getPlatform()
  if (platform === 'android') return STORE_URLS.android
  return `${STORE_URLS.ios}?action=write-review`
}

/** Support address for the feedback branch — env-configurable. */
export function supportEmail() {
  return import.meta.env.VITE_SUPPORT_EMAIL || 'rmgriffus@comcast.net'
}

/**
 * Open the user's mail client with the feedback pre-addressed + pre-filled.
 * `_system` routes to the OS mail handler on native; plain location works on web.
 */
export function sendFeedbackEmail(body) {
  const url = `mailto:${supportEmail()}`
    + `?subject=${encodeURIComponent('Bball Sim Feedback')}`
    + `&body=${encodeURIComponent(body ?? '')}`
  try {
    if (Capacitor.isNativePlatform()) {
      window.open(url, '_system')
    } else {
      window.location.href = url
    }
  } catch { /* best-effort */ }
}
