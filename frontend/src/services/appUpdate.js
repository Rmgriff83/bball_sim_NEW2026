// In-app "update available" check. NATIVE-ONLY and strictly fail-open: any
// error, missing field, or unreachable server returns null so the app is never
// nagged (or blocked) on a bad check. Compares the per-platform BUILD number
// (Android versionCode / iOS CURRENT_PROJECT_VERSION) — which is bumped every
// release — against a remote `latestBuild`, NOT the marketing version string.
import { Capacitor } from '@capacitor/core'
import api from '@/composables/useApi'

export const STORE_URLS = {
  android: 'https://play.google.com/store/apps/details?id=com.bballsim.app',
  ios: 'https://apps.apple.com/us/app/bball-sim/id6774754906',
}

/**
 * @returns {Promise<null | { platform, runningBuild, latest, storeUrl }>}
 *   null when up to date, on web, or on ANY failure (fail open).
 */
export async function checkForUpdate() {
  try {
    if (!Capacitor.isNativePlatform()) return null
    const platform = Capacitor.getPlatform()
    if (platform !== 'ios' && platform !== 'android') return null

    const { App } = await import('@capacitor/app')
    const info = await App.getInfo()
    const runningBuild = parseInt(info?.build, 10)
    if (!Number.isFinite(runningBuild)) return null

    const res = await api.get('/api/app-version', { skipErrorToast: true, timeout: 8000 })
    const latest = parseInt(res?.data?.[platform]?.latestBuild, 10)
    if (!Number.isFinite(latest)) return null

    if (runningBuild >= latest) return null
    return { platform, runningBuild, latest, storeUrl: STORE_URLS[platform] }
  } catch {
    return null // fail open — never nag on a failed/malformed check
  }
}

/** Open the store externally (system handler → Play Store / App Store app). */
export async function openStore(url) {
  try {
    if (Capacitor.isNativePlatform()) {
      // window.open('_system') is a Cordova-ism Capacitor ignores, and
      // WKWebView drops window.open after an await — Browser.open is a
      // native call and always fires (same fix as useCommunityLink.js).
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url })
      return
    }
    window.open(url, '_blank', 'noopener')
  } catch {
    // Fail-open fallback (e.g. plugin missing in an ancient binary).
    try { window.open(url, '_system') } catch { /* best-effort */ }
  }
}
