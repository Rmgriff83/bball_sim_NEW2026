<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Loader2 } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'

// Web-only landing page for the app→web one-time login handoff. Exchanges the
// nonce for a session, then continues to the intended destination. The nonce
// is single-use + 60s TTL — failures just route to the normal login.
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const failed = ref(false)

onMounted(async () => {
  const nonce = String(route.query.nonce ?? '')
  const to = String(route.query.to ?? '')
  const destination = to.startsWith('/') ? to : '/dashboard'

  if (!nonce) {
    router.replace('/login')
    return
  }
  try {
    await authStore.loginWithHandoff(nonce)
    // Only the NATIVE app lands users here (handoff mint → system browser).
    // Mark the session so web pages know "Back to app" should use the
    // bballsim:// deep link; ordinary web visitors never get this flag and
    // navigate in-app instead.
    try { sessionStorage.setItem('bball_from_native_app', '1') } catch { /* private mode */ }
    router.replace(destination)
  } catch {
    failed.value = true
    setTimeout(() => router.replace('/login'), 2500)
  }
})
</script>

<template>
  <div class="autologin">
    <template v-if="!failed">
      <Loader2 :size="34" class="spin" />
      <p>{{ $t('Signing you in…') }}</p>
    </template>
    <template v-else>
      <p>{{ $t('That sign-in link expired. Taking you to the login page…') }}</p>
    </template>
  </div>
</template>

<style scoped>
.autologin {
  min-height: 70vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--color-text-secondary);
}

.spin {
  animation: al-spin 1s linear infinite;
  color: var(--color-primary);
}

@keyframes al-spin {
  to { transform: rotate(360deg); }
}
</style>
