import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import { setToastStore } from './composables/useApi'
import { useToastStore } from './stores/toast'
import { useSyncStore } from './stores/sync'
import { useAudioStore } from './stores/audio'
import { unlock as unlockAudio } from './services/audioEngine'
import I18nPlugin from '@wl-i18n/plugin.js'

// Styles
import './assets/styles/main.css'

// Tag <html> with the runtime platform so platform-specific CSS can opt in
// (e.g. iOS-only floating-glass bottom nav in BottomNav.vue). Capacitor's
// getPlatform() returns 'ios' | 'android' | 'web'. Runs synchronously
// before app.mount, so the class is present on first paint.
import { Capacitor } from '@capacitor/core'
document.documentElement.classList.add('platform-' + Capacitor.getPlatform())

// Ask the platform to mark our IndexedDB / localStorage as persistent.
// On iOS WKWebView this hints that the campaign cache should survive
// storage-pressure eviction. No-op where unsupported.
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {})
}

// Global handler for chunk loading errors (happens after deployment)
// Catches errors from async components, dynamic imports, etc.
window.addEventListener('error', (event) => {
  if (
    event.message?.includes('Failed to fetch dynamically imported module') ||
    event.message?.includes('Importing a module script failed') ||
    event.message?.includes('Loading chunk') ||
    event.message?.includes('Loading CSS chunk')
  ) {
    console.warn('[ChunkError] Detected stale chunk, reloading page...')
    window.location.reload()
  }
})

// Also catch unhandled promise rejections for dynamic imports
window.addEventListener('unhandledrejection', (event) => {
  const message = event.reason?.message || ''
  if (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('Loading chunk') ||
    message.includes('Loading CSS chunk')
  ) {
    console.warn('[ChunkError] Detected stale chunk in promise, reloading page...')
    event.preventDefault()
    window.location.reload()
  }
})

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
// Build-time-only i18n (vendored wl-i18n): registers $t/$tDynamic, detects the
// saved/browser locale, and lazy-loads its committed locale chunk. Zero
// runtime translation network calls.
app.use(I18nPlugin, { sourceLanguage: 'en' })

// Initialize toast store for API error handling
const toastStore = useToastStore(pinia)
setToastStore(toastStore)

// Initialize audio store so persisted sound prefs (enabled/volume) load and
// apply to the engine at startup.
const audioStore = useAudioStore(pinia)

// WebAudio starts suspended on iOS/Safari (incl. Capacitor WKWebView) and can
// only be resumed from inside a user gesture. Unlock it once on the first tap.
document.addEventListener('pointerdown', () => unlockAudio(), { once: true })

// A modal/popup dismissal button — the close "X" (aria-label="Close" or a
// class token like `modal-close`, `pe-close`, `close-btn`, `btn-close`) or a
// footer Cancel/Close button (`btn-cancel`, `pe-cancel`, `skip-cancel`, …).
// Word-boundary tokens only, so `resign-closed` doesn't match. Dismiss
// handlers that play their own dedicated sound call audio.cancel(), which
// sets the suppress flag, so this never double-fires.
function isDismissButton(el) {
  const aria = (el.getAttribute('aria-label') || '').toLowerCase()
  if (aria === 'close' || aria === 'dismiss') return true
  for (const c of el.classList) {
    if (
      c === 'close' || c.endsWith('-close') || c === 'close-btn' || c.startsWith('btn-close') ||
      c === 'cancel' || c.endsWith('-cancel') || c === 'cancel-btn' || c.startsWith('btn-cancel')
    ) return true
  }
  return false
}

// A modal backdrop click ("click off" a popup). Backdrops across the app are
// full-viewport fixed/absolute containers with an `overlay`/`backdrop` class
// that close via @click.self — so the click target IS the backdrop element
// itself. The size guard excludes panel-style containers that merely have
// "overlay" in their name (e.g. the in-court coaches overlay).
function isModalBackdrop(el) {
  let named = false
  for (const c of el.classList) {
    if (c.includes('overlay') || c.includes('backdrop')) { named = true; break }
  }
  if (!named) return false
  const r = el.getBoundingClientRect()
  return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9
}

// Play the generic tap on every button click, app-wide. Runs in the bubble
// phase (after the element's own click handler), so a purchase (cha-ching) or
// modal dismissal (cancel) can call audioStore.suppressClickSound() during the
// click to opt that specific button out of the generic tap.
// Closing a popup — via its X button or by clicking off onto the backdrop —
// plays the cancel SFX (same sound as declining a trade) instead of the tap.
document.addEventListener('click', (e) => {
  // Buttons and navigation links (router-link renders <a href>) both count as
  // clickable controls that should tap.
  const el = e.target?.closest?.('button, [role="button"], a[href]')
  if (el) {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return
    if (isDismissButton(el)) {
      audioStore.cancelFromGlobalClick()
      return
    }
    audioStore.navigate()
    return
  }
  // Not a control — check for a backdrop (click-off) dismissal.
  const target = e.target
  if (target instanceof Element && isModalBackdrop(target)) {
    audioStore.cancelFromGlobalClick()
  }
})

// Initialize sync store and start auto-sync
const syncStore = useSyncStore(pinia)
syncStore.initFromCache().then(() => {
  syncStore.startAutoSync()
})

// On close / refresh: fire a best-effort push if there are unsaved changes,
// and show the browser's confirm-leave prompt. The prompt buys time for the
// in-flight request to land; browsers won't await async work in `beforeunload`,
// so this is intentionally fire-and-forget.
window.addEventListener('beforeunload', (e) => {
  if (syncStore.hasPendingChanges && syncStore.activeCampaignId) {
    try {
      syncStore.syncNow()
    } catch {
      // ignore — best effort
    }
    e.preventDefault()
    e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
  }
})

app.mount('#app')
