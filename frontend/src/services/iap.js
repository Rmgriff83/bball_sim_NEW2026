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

const API_KEY = import.meta.env.VITE_REVENUECAT_API_KEY

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
    throw new Error('VITE_REVENUECAT_API_KEY is not set')
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
