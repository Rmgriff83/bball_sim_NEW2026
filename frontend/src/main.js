import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import { setToastStore } from './composables/useApi'
import { useToastStore } from './stores/toast'
import { useSyncStore } from './stores/sync'

// Styles
import './assets/styles/main.css'

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
