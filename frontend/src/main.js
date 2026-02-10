import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import { setToastStore } from './composables/useApi'
import { useToastStore } from './stores/toast'
import { useSyncStore } from './stores/sync'

// Styles
import './assets/styles/main.css'

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
