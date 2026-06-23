<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import {
  availableProviders,
  signInWithApple,
  renderGoogleButton,
} from '@/services/socialAuth'

defineProps({
  // 'login' | 'register' — affects the Apple button label only.
  mode: { type: String, default: 'login' },
})
const emit = defineEmits(['error'])

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const providers = availableProviders()
const showApple = providers.includes('apple')
const showGoogle = providers.includes('google')

const googleBtn = ref(null)
const busy = ref(false)
// Reactive mirror so a failed Google init can hide the row.
const showGoogleSafe = ref(showGoogle)

function finishAndRedirect() {
  router.push(route.query.redirect || '/dashboard')
}

async function handleCredential(payload) {
  if (!payload?.credential) return
  busy.value = true
  emit('error', '')
  try {
    await authStore.loginWithSocial(payload)
    finishAndRedirect()
  } catch (err) {
    emit('error', err.response?.data?.message || 'Social sign-in failed. Please try again.')
  } finally {
    busy.value = false
  }
}

async function handleApple() {
  if (busy.value) return
  emit('error', '')
  try {
    const result = await signInWithApple()
    await handleCredential(result)
  } catch (err) {
    // Ignore user-cancelled popups/sheets; surface real errors.
    const code = err?.error || err?.code
    if (code === 'popup_closed_by_user' || code === 'user_cancelled_authorize' || code === '1001') return
    emit('error', err?.message || 'Apple sign-in failed. Please try again.')
  }
}

onMounted(async () => {
  if (!showGoogle || !googleBtn.value) return
  try {
    await renderGoogleButton(googleBtn.value, handleCredential)
  } catch (err) {
    // Misconfigured/unavailable — hide rather than show a broken button.
    showGoogleSafe.value = false
    console.warn('[SocialAuth] Google button unavailable:', err?.message)
  }
})
</script>

<template>
  <div class="social-auth">
    <!-- Apple -->
    <button
      v-if="showApple"
      type="button"
      class="social-btn apple-btn"
      :disabled="busy"
      @click="handleApple"
    >
      <svg class="social-icon" viewBox="0 0 384 512" aria-hidden="true">
        <path
          fill="currentColor"
          d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
        />
      </svg>
      <span>{{ mode === 'register' ? 'Sign up with Apple' : 'Sign in with Apple' }}</span>
    </button>

    <!-- Google (official GIS-rendered button mounts here) -->
    <div v-if="showGoogleSafe" ref="googleBtn" class="google-btn-host"></div>
  </div>
</template>

<style scoped>
.social-auth {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.25rem;
}

.social-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  width: 100%;
  max-width: 320px;
  height: 44px;
  border-radius: 999px;
  border: none;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.05s ease;
}

.social-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.social-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.apple-btn {
  background: #000;
  color: #fff;
}

.apple-btn:hover:not(:disabled) {
  background: #111;
}

.social-icon {
  width: 18px;
  height: 18px;
}

/* Google renders its own brand-compliant button into this host. */
.google-btn-host {
  display: flex;
  justify-content: center;
  min-height: 44px;
  width: 100%;
}
</style>
