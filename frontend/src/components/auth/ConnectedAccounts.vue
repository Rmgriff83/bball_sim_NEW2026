<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { BaseButton } from '@/components/ui'
import { availableProviders, signInWithApple, renderGoogleButton } from '@/services/socialAuth'

const authStore = useAuthStore()
const toastStore = useToastStore()

const available = availableProviders()
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
    toastStore.showSuccess(`${cap(payload.provider)} account linked.`)
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
    toastStore.showError(err?.message || 'Apple sign-in failed.')
  }
}

async function unlink(provider) {
  if (busy.value) return
  busy.value = provider
  confirming.value = ''
  try {
    await authStore.unlinkSocial(provider)
    toastStore.showSuccess(`${cap(provider)} account unlinked.`)
  } catch {
    // interceptor toasts the reason (e.g. "set a password first").
  } finally {
    busy.value = ''
    renderGoogleIfNeeded()
  }
}

// Google's credential flow requires its own rendered button. (Re)render it into
// the host whenever Google is unlinkable + available on this platform.
async function renderGoogleIfNeeded() {
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
    <h3 class="section-title">Connected Accounts</h3>
    <p class="section-hint">
      Link Apple or Google to sign in faster. Linking connects your account directly,
      so it works even if you chose “Hide My Email”.
    </p>

    <div class="provider-list">
      <!-- Apple -->
      <div class="provider-row">
        <div class="provider-id">
          <span class="provider-name">Apple</span>
          <span v-if="appleLinked" class="connected-badge">Connected</span>
        </div>
        <div class="provider-action">
          <template v-if="appleLinked">
            <template v-if="confirming === 'apple'">
              <BaseButton variant="danger" :loading="busy === 'apple'" @click="unlink('apple')">Confirm</BaseButton>
              <BaseButton variant="ghost" @click="confirming = ''">Cancel</BaseButton>
            </template>
            <BaseButton v-else variant="ghost" :disabled="!!busy" @click="confirming = 'apple'">Unlink</BaseButton>
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
            Link Apple
          </button>
          <span v-else class="unavailable-note">Not available here</span>
        </div>
      </div>

      <!-- Google -->
      <div class="provider-row">
        <div class="provider-id">
          <span class="provider-name">Google</span>
          <span v-if="googleLinked" class="connected-badge">Connected</span>
        </div>
        <div class="provider-action">
          <template v-if="googleLinked">
            <template v-if="confirming === 'google'">
              <BaseButton variant="danger" :loading="busy === 'google'" @click="unlink('google')">Confirm</BaseButton>
              <BaseButton variant="ghost" @click="confirming = ''">Cancel</BaseButton>
            </template>
            <BaseButton v-else variant="ghost" :disabled="!!busy" @click="confirming = 'google'">Unlink</BaseButton>
          </template>
          <div v-else-if="canLinkGoogle" ref="googleHost" class="google-host"></div>
          <span v-else class="unavailable-note">Not available here</span>
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

.unavailable-note {
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
}
</style>
