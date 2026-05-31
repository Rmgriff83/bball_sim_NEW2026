import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import { setToastStore } from './composables/useApi'
import { useToastStore } from './stores/toast'
import { useSyncStore } from './stores/sync'
import { useAudioStore } from './stores/audio'
import { unlock as unlockAudio } from './services/audioEngine'

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

// Initialize toast store for API error handling
const toastStore = useToastStore(pinia)
setToastStore(toastStore)

// Initialize audio store so persisted sound prefs (enabled/volume) load and
// apply to the engine at startup.
const audioStore = useAudioStore(pinia)

// WebAudio starts suspended on iOS/Safari (incl. Capacitor WKWebView) and can
// only be resumed from inside a user gesture. Unlock it once on the first tap.
document.addEventListener('pointerdown', () => unlockAudio(), { once: true })

// Play the generic tap on every button click, app-wide. Runs in the bubble
// phase (after the element's own click handler), so a purchase (cha-ching) or
// modal dismissal (cancel) can call audioStore.suppressClickSound() during the
// click to opt that specific button out of the generic tap.
document.addEventListener('click', (e) => {
  // Buttons and navigation links (router-link renders <a href>) both count as
  // clickable controls that should tap.
  const el = e.target?.closest?.('button, [role="button"], a[href]')
  if (!el) return
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return
  audioStore.navigate()
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
