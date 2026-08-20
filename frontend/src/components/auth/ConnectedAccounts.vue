<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { BaseButton } from '@/components/ui'
import { availableProviders, signInWithApple, signInWithGoogleNative, renderGoogleButton, platform } from '@/services/socialAuth'
import { t } from '@wl-i18n/i18n.js'

const authStore = useAuthStore()
const toastStore = useToastStore()

const available = availableProviders()
// On native Android, Google linking must use the native Credential Manager flow
// (same as the login screen) — the web GSI iframe button can't render inside the
// Capacitor WebView (https://localhost isn't an authorized GSI origin), which
// previously left an empty spot where the Link button should be.
const googleIsNative = platform() === 'android'
const busy = ref('')        // provider id currently processing
const confirming = ref('')  // provider id pending unlink confirmation
const googleHost = ref(null)

const appleLinked = computed(() => authStore.linkedProviders.includes('apple'))
const googleLinked = computed(() => authStore.linkedProviders.includes('google'))
const canLinkApple = computed(() => available.includes('apple'))
const canLinkGoogle = computed(() => available.includes('google'))

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

async function handleLinkCredential(payload) {
  if (!payload?.credential || busy.value) return
  busy.value = payload.provider
  try {
    await authStore.linkSocial(payload)
    toastStore.showSuccess(t('{provider} account linked.', { provider: cap(payload.provider) }))
  } catch {
    // The useApi interceptor already surfaced the server message (e.g. the 409
    // "already linked to another user").
  } finally {
    busy.value = ''
    renderGoogleIfNeeded()
  }
}

async function linkApple() {
  if (busy.value) return
  try {
    const result = await signInWithApple()
    await handleLinkCredential(result)
  } catch (err) {
    const code = err?.error || err?.code
    // Ignore user-cancelled popups/sheets; surface real failures.
    if (code === 'popup_closed_by_user' || code === 'user_cancelled_authorize' || code === '1001') return
    toastStore.showError(err?.message || t('Apple sign-in failed.'))
  }
}

// Native Android Google linking — same Credential Manager flow as the login
// screen, then the shared link handler.
async function linkGoogle() {
  if (busy.value) return
  try {
    const result = await signInWithGoogleNative()
    await handleLinkCredential(result)
  } catch (err) {
    const code = String(err?.error || err?.code || '')
    // Ignore user-cancelled sheets; surface real failures.
    if (code.includes('cancel') || code === '16') return
    toastStore.showError(err?.message || t('Google sign-in failed.'))
  }
}

async function unlink(provider) {
  if (busy.value) return
  busy.value = provider
  confirming.value = ''
  try {
    await authStore.unlinkSocial(provider)
    toastStore.showSuccess(t('{provider} account unlinked.', { provider: cap(provider) }))
  } catch {
    // interceptor toasts the reason (e.g. "set a password first").
  } finally {
    busy.value = ''
    renderGoogleIfNeeded()
  }
}

// Google's WEB credential flow requires its own rendered GSI button. (Re)render
// it into the host whenever Google is unlinkable + available on this platform.
// Native Android uses the plain Link button + native flow instead.
async function renderGoogleIfNeeded() {
  if (googleIsNative) return
  await nextTick()
  if (!canLinkGoogle.value || googleLinked.value || !googleHost.value) return
  googleHost.value.innerHTML = ''
  try {
    await renderGoogleButton(googleHost.value, handleLinkCredential, { text: 'continue_with' })
  } catch (e) {
    console.warn('[ConnectedAccounts] Google button unavailable:', e?.message)
  }
}

onMounted(renderGoogleIfNeeded)
watch(googleLinked, renderGoogleIfNeeded)
</script>

<template>
  <div class="profile-section">
    <h3 class="section-title">{{ $t('Connected Accounts') }}</h3>
    <p class="section-hint">
      {{ $t('Link Apple or Google to sign in faster. Linking connects your account directly, so it works even if you chose “Hide My Email”.') }}
    </p>

    <div class="provider-list">
      <!-- Apple -->
      <div class="provider-row">
        <div class="provider-id">
          <!-- i18n-ignore -->
          <span class="provider-name">Apple</span>
          <span v-if="appleLinked" class="connected-badge">{{ $t('Connected') }}</span>
        </div>
        <div class="provider-action">
          <template v-if="appleLinked">
            <div v-if="confirming === 'apple'" class="confirm-actions">
              <BaseButton variant="danger" :loading="busy === 'apple'" @click="unlink('apple')">{{ $t('Confirm') }}</BaseButton>
              <BaseButton variant="ghost" @click="confirming = ''">{{ $t('Cancel') }}</BaseButton>
            </div>
            <BaseButton v-else variant="ghost" :disabled="!!busy" @click="confirming = 'apple'">{{ $t('Unlink') }}</BaseButton>
          </template>
          <button
            v-else-if="canLinkApple"
            type="button"
            class="link-apple-btn"
            :disabled="busy === 'apple'"
            @click="linkApple"
          >
            <svg class="apple-glyph" viewBox="0 0 384 512" aria-hidden="true">
              <path fill="currentColor" d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
            </svg>
            {{ $t('Link Apple') }}
          </button>
          <span v-else class="unavailable-note">{{ $t('Not available here') }}</span>
        </div>
      </div>

      <!-- Google -->
      <div class="provider-row">
        <div class="provider-id">
          <!-- i18n-ignore -->
          <span class="provider-name">Google</span>
          <span v-if="googleLinked" class="connected-badge">{{ $t('Connected') }}</span>
        </div>
        <div class="provider-action">
          <template v-if="googleLinked">
            <div v-if="confirming === 'google'" class="confirm-actions">
              <BaseButton variant="danger" :loading="busy === 'google'" @click="unlink('google')">{{ $t('Confirm') }}</BaseButton>
              <BaseButton variant="ghost" @click="confirming = ''">{{ $t('Cancel') }}</BaseButton>
            </div>
            <BaseButton v-else variant="ghost" :disabled="!!busy" @click="confirming = 'google'">{{ $t('Unlink') }}</BaseButton>
          </template>
          <button
            v-else-if="canLinkGoogle && googleIsNative"
            type="button"
            class="link-google-btn"
            :disabled="busy === 'google'"
            @click="linkGoogle"
          >
            <svg class="google-glyph" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            {{ $t('Link Google') }}
          </button>
          <div v-else-if="canLinkGoogle" ref="googleHost" class="google-host"></div>
          <span v-else class="unavailable-note">{{ $t('Not available here') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.section-hint {
  margin: 0 0 1rem 0;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.provider-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  min-height: 56px;
}

.provider-id {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.provider-name {
  font-weight: 600;
  color: var(--color-text-primary);
}

.connected-badge {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #34d399;
  background: rgba(52, 211, 153, 0.12);
  border: 1px solid rgba(52, 211, 153, 0.3);
  border-radius: 999px;
  padding: 2px 8px;
}

.provider-action {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Confirm/Cancel pair for unlinking — side by side on desktop, stacked on
   mobile so the two buttons don't crowd the row. */
.confirm-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

@media (max-width: 640px) {
  .confirm-actions {
    flex-direction: column;
    align-items: stretch;
    gap: 0.4rem;
  }
}

.link-apple-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  height: 38px;
  padding: 0 14px;
  border: none;
  border-radius: 999px;
  background: #000;
  color: #fff;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.link-apple-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.apple-glyph {
  width: 15px;
  height: 15px;
}

.google-host {
  min-height: 38px;
}

/* Native Android "Link Google" button — mirrors the Apple button's shape with
   Google's light branding. */
.link-google-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  height: 38px;
  padding: 0 14px;
  border: 1px solid #dadce0;
  border-radius: 999px;
  background: #fff;
  color: #3c4043;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.link-google-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.google-glyph {
  width: 16px;
  height: 16px;
}

.unavailable-note {
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
}
</style>
