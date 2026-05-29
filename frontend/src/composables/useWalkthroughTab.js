import { watch } from 'vue'
import { useWalkthroughStore } from '@/stores/walkthrough'

// Lets a view expose its internal tab state to the walkthrough engine. When the
// overlay needs a step to be shown on a particular tab, it calls
// store.requestTab(view, tab); this watcher applies it via the supplied setter.
//
// Usage inside a view's <script setup>:
//   useWalkthroughTab('gm', (tab) => { activeTab.value = tab })
export function useWalkthroughTab(view, setTab) {
  const walkthrough = useWalkthroughStore()

  watch(
    () => walkthrough.requestedTab,
    (req) => {
      if (req && req.view === view && req.tab) {
        setTab(req.tab)
      }
    },
    { immediate: true }
  )
}
