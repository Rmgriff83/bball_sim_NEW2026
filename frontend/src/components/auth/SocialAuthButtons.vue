<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import {
  availableProviders,
  platform,
  signInWithApple,
  signInWithGoogleNative,
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
// Android uses the native plugin flow (a tappable button); web uses Google's
// GIS-rendered button mounted into the host div.
const nativeGoogle = showGoogle && platform() === 'android'

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

async function handleGoogleNative() {
  if (busy.value) return
  emit('error', '')
  try {
    const result = await signInWithGoogleNative()
    await handleCredential(result)
  } catch (err) {
    // Ignore user-cancelled sheets; surface real errors. (Android cancel codes vary.)
    const code = String(err?.error ?? err?.code ?? '')
    if (code === '12501' || code === 'user_cancelled' || /cancel/i.test(err?.message || '')) return
    emit('error', err?.message || 'Google sign-in failed. Please try again.')
  }
}

onMounted(async () => {
  // Native Android uses a plain button (handleGoogleNative); only the WEB GIS
  // button needs rendering into the host.
  if (!showGoogle || nativeGoogle || !googleBtn.value) return
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

    <!-- Google: native plugin button on Android, GIS-rendered host on web. -->
    <button
      v-if="nativeGoogle"
      type="button"
      class="social-btn google-btn"
      :disabled="busy"
      @click="handleGoogleNative"
    >
      <svg class="social-icon" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      <span>{{ mode === 'register' ? 'Sign up with Google' : 'Sign in with Google' }}</span>
    </button>
    <div v-else-if="showGoogleSafe" ref="googleBtn" class="google-btn-host"></div>
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

/* Google brand button (Android native flow). White surface per brand guidance. */
.google-btn {
  background: #fff;
  color: #1f1f1f;
  border: 1px solid #dadce0;
}

.google-btn:hover:not(:disabled) {
  background: #f7f8f8;
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
