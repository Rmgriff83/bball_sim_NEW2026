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

// Warn on close if there are unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (syncStore.hasPendingChanges) {
    e.preventDefault()
    e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
  }
})

app.mount('#app')
