/**
 * iap.js — RevenueCat (StoreKit 2) wrapper for native iOS builds.
 *
 * Web builds keep Stripe; this file is only invoked when
 * Capacitor.isNativePlatform() is true. The web bundle still imports it
 * (tree-shaking permitting), so all calls are async and tolerant of an
 * un-configured SDK.
 *
 * Server-side trust: tokens are credited by the backend via the RevenueCat
 * webhook (see PaymentController::revenueCatWebhook). The transaction id
 * returned from purchase() is only used for the defense-in-depth /verify
 * endpoint that shortens the post-purchase wait if the webhook is delayed.
 */

import { Purchases, LOG_LEVEL } from '@revenuecat/purchases-capacitor'
import { Capacitor } from '@capacitor/core'

// RevenueCat uses a DIFFERENT public key per store: an Apple key (appl_…) for
// iOS/App Store and a Google key (goog_…) for Android/Play. Pick by platform.
// Falls back to the legacy single var so existing iOS builds keep working if the
// platform-specific iOS var isn't set.
const API_KEY = Capacitor.getPlatform() === 'android'
  ? import.meta.env.VITE_REVENUECAT_API_KEY_ANDROID
  : (import.meta.env.VITE_REVENUECAT_API_KEY_IOS || import.meta.env.VITE_REVENUECAT_API_KEY)

let configured = false
let currentAppUserID = null

/**
 * Configure the SDK and identify the user. Safe to call repeatedly —
 * configure() runs once; subsequent calls only update the appUserID.
 *
 * @param {string|number} userId — the authenticated user id from auth.user.id
 */
export async function initIAP(userId) {
  if (!API_KEY) {
    throw new Error('RevenueCat API key is not set for this platform (VITE_REVENUECAT_API_KEY_ANDROID / _IOS)')
  }
  const appUserID = String(userId)

  if (!configured) {
    await Purchases.configure({ apiKey: API_KEY, appUserID })
    if (import.meta.env.DEV) {
      await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG })
    }
    configured = true
    currentAppUserID = appUserID
    return
  }

  if (currentAppUserID !== appUserID) {
    await Purchases.logIn({ appUserID })
    currentAppUserID = appUserID
  }
}

/**
 * Return the current Offering (with available packages). Throws if the SDK
 * isn't configured or no "current" offering is set in the RC dashboard.
 */
export async function getCurrentOffering() {
  const offerings = await Purchases.getOfferings()
  const current = offerings.current
  if (!current) {
    throw new Error('RevenueCat current offering is not set')
  }
  return current
}

/**
 * Return a map of `{ productId: priceString }` for every product in the
 * current RevenueCat offering. Used by the Store view to display live
 * App-Store-Connect-driven prices instead of hardcoded placeholders, so
 * a price change in App Store Connect propagates to the catalog without
 * a code change or resubmission.
 *
 * Safe by design: returns `{}` (not a throw) when the SDK isn't configured,
 * the offering hasn't loaded, or any other RevenueCat-side error fires.
 * Callers fall back to their hardcoded `bundle.price` strings on `{}`.
 */
export async function getProductPrices() {
  if (!configured) return {}
  try {
    const offering = await getCurrentOffering()
    const out = {}
    for (const pkg of offering.availablePackages ?? []) {
      const id = pkg?.product?.identifier
      const priceString = pkg?.product?.priceString
      if (id && priceString) out[id] = priceString
    }
    return out
  } catch (err) {
    console.warn('[IAP] getProductPrices failed; falling back to placeholders', err)
    return {}
  }
}

/**
 * Open the StoreKit purchase sheet for the given App Store product id.
 *
 * @param {string} productId — e.g. 'tokens_1000' / 'tokens_6500'.
 *   Must match an IAP product id that's mapped to a package in the
 *   current RC offering.
 * @returns {Promise<{ success: boolean, cancelled?: boolean,
 *   productIdentifier?: string, transactionIdentifier?: string }>}
 *   User cancels resolve with { success: false, cancelled: true } rather
 *   than throw, so callers can distinguish UX cancel from real errors.
 */
export async function purchase(productId) {
  const offering = await getCurrentOffering()
  const pkg = offering.availablePackages.find(
    (p) => p.product?.identifier === productId
  )
  if (!pkg) {
    throw new Error(
      `No package for product '${productId}' in offering '${offering.identifier}'`
    )
  }

  try {
    const result = await Purchases.purchasePackage({ aPackage: pkg })
    return {
      success: true,
      productIdentifier: result.productIdentifier,
      transactionIdentifier: result.transaction?.transactionIdentifier ?? null,
    }
  } catch (err) {
    if (err?.userCancelled === true) {
      return { success: false, cancelled: true }
    }
    throw err
  }
}

/**
 * Restore prior non-consumable purchases for the current Apple ID. Required
 * by App Store Review Guideline 3.1.1 for apps that sell non-consumables
 * (e.g. the headshot_editor_unlock). RevenueCat re-validates StoreKit
 * receipts and re-fires the entitlement webhook server-side, which idempotently
 * sets the unlock flag on the user profile. Callers should follow up with
 * authStore.fetchUser() so the refreshed `unlockedFeatures` array lands locally.
 *
 * No-op on web — Stripe purchases are already fulfilled via webhook and
 * a refreshed fetchUser() returns the same entitlement state.
 *
 * @returns {Promise<{ success: boolean, cancelled?: boolean, reason?: string,
 *   customerInfo?: object, error?: string }>}
 */
export async function restorePurchases() {
  if (!configured) {
    return { success: false, reason: 'not_configured' }
  }
  try {
    const { customerInfo } = await Purchases.restorePurchases()
    return { success: true, customerInfo }
  } catch (err) {
    if (err?.userCancelled === true) {
      return { success: false, cancelled: true }
    }
    console.error('[IAP] restorePurchases failed', err)
    return { success: false, error: err?.message ?? 'restore_failed' }
  }
}

/**
 * Drop the identified user. Call on logout so the next user gets a fresh
 * anonymous appUserID rather than inheriting receipts.
 */
export async function logoutIAP() {
  if (!configured) return
  try {
    await Purchases.logOut()
    currentAppUserID = null
  } catch {
    // logOut throws if already anonymous; nothing actionable.
  }
}
