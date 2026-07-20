import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { checkForUpdate, openStore } from '@/services/appUpdate'

// Soft update-nag state. `dismissed` is intentionally in-memory only (never
// persisted) so the prompt reappears on the next cold start until the user
// actually updates. Native-only + fail-open — the service returns null on web
// or any failure, so `updateInfo` simply stays null and nothing shows.
export const useAppUpdateStore = defineStore('appUpdate', () => {
  const updateInfo = ref(null) // { platform, runningBuild, latest, storeUrl } | null
  const dismissed = ref(false)

  const showNag = computed(() => !!updateInfo.value && !dismissed.value)

  async function check() {
    const info = await checkForUpdate()
    if (info) updateInfo.value = info
  }

  function dismiss() {
    dismissed.value = true
  }

  function goToStore() {
    if (updateInfo.value?.storeUrl) openStore(updateInfo.value.storeUrl)
  }

  return { updateInfo, dismissed, showNag, check, dismiss, goToStore }
})
