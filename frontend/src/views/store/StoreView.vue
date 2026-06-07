<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { GlassCard, BaseModal } from '@/components/ui'
import { ArrowLeft, Coins, Palette, RotateCcw, Check } from 'lucide-vue-next'
import api from '@/composables/useApi'
import * as iap from '@/services/iap'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const toastStore = useToastStore()

const purchasing = ref(false)
const restoring = ref(false)
const confirmBundle = ref(null)

const tokenBalance = computed(() => authStore.profile?.tokens ?? 0)
const isNative = Capacitor.isNativePlatform()

// Wait for the RevenueCat → backend webhook to actually fulfill the
// purchase server-side. StoreKit can resolve before Apple's server-to-
// server notification reaches our backend (typically 1-5s, occasionally
// longer under load), so a one-shot fetchUser races ahead and shows the
// stale balance. Poll until the relevant field changes or we hit ~12s,
// then bail — the success toast still fires either way and the next
// page mount will pick up the credited balance.
async function _waitForFulfillment(bundle, beforeTokens) {
  const MAX_ATTEMPTS = 8
  const DELAY_MS = 1500
  const isUnlock = bundle.kind === 'unlock'
  const hadFeature = isUnlock && bundle.feature
    ? authStore.hasFeature(bundle.feature)
    : false
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try { await authStore.fetchUser() } catch { /* network blip — retry */ }
    if (isUnlock && bundle.feature) {
      if (!hadFeature && authStore.hasFeature(bundle.feature)) return
    } else {
      const after = authStore.profile?.tokens ?? 0
      if (after > beforeTokens) return
    }
    if (i < MAX_ATTEMPTS - 1) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS))
    }
  }
}

// Consumable token bundles (existing).
const tokenBundles = [
  { id: 'tokens_1000', kind: 'tokens', amount: 1000, price: '$0.99', label: '1,000' },
  { id: 'tokens_6500', kind: 'tokens', amount: 6500, price: '$4.99', label: '6,500', bestValue: true }
]

// Non-consumable one-time unlocks. Pricing is configured in App Store Connect
// + the RevenueCat dashboard; the `price` shown here is a placeholder that
// the native sheet overrides at purchase time.
const unlockBundles = [
  {
    id: 'headshot_editor_unlock',
    kind: 'unlock',
    feature: 'headshot_editor',
    price: '$5.99',
    label: 'Headshot Editor',
    description: 'Customize any player\'s, coach\'s, or other personnel\'s headshot. Also unlocks renaming your team on campaign creation. One-time purchase.'
  }
]

function isUnlockOwned(bundle) {
  return bundle.kind === 'unlock' && authStore.hasFeature(bundle.feature)
}

// Show the sandbox banner whenever the publishable key is a Stripe test key,
// regardless of whether this is a dev or prod build.
const isStripeSandbox = computed(() => {
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ''
  return !key || key.startsWith('pk_test_')
})

function promptPurchase(bundle) {
  if (isUnlockOwned(bundle)) return
  confirmBundle.value = bundle
}

async function restorePurchases() {
  if (restoring.value) return
  restoring.value = true
  try {
    if (isNative) {
      const result = await iap.restorePurchases()
      if (result.cancelled) return
      if (!result.success) {
        toastStore.showError('Could not restore purchases.')
        return
      }
    }
    // Always re-fetch the profile — web purchases land via webhook and are
    // recovered just by re-reading the user record.
    try {
      await authStore.fetchUser()
    } catch {}
    toastStore.showSuccess('Purchases restored.')
  } finally {
    restoring.value = false
  }
}

function cancelPurchase() {
  if (!purchasing.value) {
    confirmBundle.value = null
  }
}

async function confirmPurchase() {
  if (purchasing.value || !confirmBundle.value) return
  purchasing.value = true

  const bundle = confirmBundle.value

  const isUnlock = bundle.kind === 'unlock'
  const successMessage = isUnlock
    ? 'Purchase complete! Feature unlocked.'
    : 'Purchase complete! Tokens added to your account.'

  if (isNative) {
    // Native iOS — StoreKit 2 via RevenueCat. Tokens / unlocks are credited
    // server-side by the RevenueCat webhook AFTER StoreKit returns success.
    // The Apple → RevenueCat → our-backend hop is server-to-server and
    // typically lands in 1-5 seconds, but a single fetchUser fired
    // immediately after iap.purchase() resolves often races ahead of it —
    // the user sees the old balance until they navigate away/back. Poll
    // with backoff up to ~12s waiting for the balance to actually change.
    try {
      const beforeTokens = authStore.profile?.tokens ?? 0
      const result = await iap.purchase(bundle.id)
      if (result.cancelled) {
        purchasing.value = false
        confirmBundle.value = null
        return
      }
      await _waitForFulfillment(bundle, beforeTokens)
      toastStore.showSuccess(successMessage)
      confirmBundle.value = null
    } catch (err) {
      console.error('IAP purchase failed', err)
      toastStore.showError('Purchase failed. Please try again.')
    } finally {
      purchasing.value = false
    }
    return
  }

  // Web — Stripe Checkout redirect (unchanged).
  try {
    const response = await api.post('/api/payments/checkout-session', {
      bundle_id: bundle.id
    })
    window.location.href = response.data.url
  } catch (error) {
    purchasing.value = false
    toastStore.showError('Could not start checkout. Please try again.')
  }
}

onMounted(async () => {
  // Native: configure RevenueCat for this user so purchase() can fetch
  // offerings and trigger StoreKit. initIAP is idempotent.
  if (isNative && authStore.user?.id) {
    try {
      await iap.initIAP(authStore.user.id)
    } catch (err) {
      console.error('initIAP failed', err)
    }
  }

  // Web only — Stripe redirects back to /store?checkout=success or
  // ?checkout=cancel after the hosted checkout flow.
  const status = route.query.checkout
  if (status === 'success') {
    try {
      await authStore.fetchUser()
    } catch {}
    toastStore.showSuccess('Purchase complete!')
    router.replace({ query: {} })
  } else if (status === 'cancel') {
    toastStore.showError('Purchase canceled.')
    router.replace({ query: {} })
  }
})
</script>

<template>
  <div class="store-page">
    <!-- Header -->
    <header class="store-header">
      <div class="header-container">
        <button class="back-link" @click="router.push({ name: 'campaigns' })">
          <ArrowLeft :size="20" />
        </button>
        <h1 class="page-title">Store</h1>
        <div class="header-spacer" />
      </div>
    </header>

    <!-- Main Content -->
    <main class="store-main">
      <div class="store-container">
        <!-- Sandbox Banner — Stripe sandbox banner is web-only -->
        <div v-if="!isNative && isStripeSandbox" class="test-banner">
          Sandbox Mode — use Stripe test cards
        </div>

        <!-- Token Balance -->
        <div class="balance-section">
          <div class="balance-card">
            <div class="balance-icon">
              <Coins :size="24" />
            </div>
            <div class="balance-info">
              <span class="balance-label">Your Balance</span>
              <span class="balance-amount">{{ tokenBalance.toLocaleString() }}</span>
            </div>
          </div>
        </div>

        <!-- Token Bundles -->
        <section class="bundles-section">
          <h2 class="section-title">Award Tokens</h2>
          <p class="section-subtitle">Use tokens to upgrade facilities, hire scouts, and more</p>

          <div class="bundles-grid">
            <GlassCard
              v-for="bundle in tokenBundles"
              :key="bundle.id"
              padding="lg"
              class="bundle-card"
              :class="{ 'best-value': bundle.bestValue }"
            >
              <div v-if="bundle.bestValue" class="best-value-badge">Best Value</div>
              <div class="bundle-icon">
                <Coins :size="32" />
              </div>
              <div class="bundle-amount">{{ bundle.label }}</div>
              <div class="bundle-label">Award Tokens</div>
              <div class="bundle-price">{{ bundle.price }}</div>
              <button
                class="purchase-btn"
                @click="promptPurchase(bundle)"
              >
                Purchase
              </button>
            </GlassCard>
          </div>
        </section>

        <!-- One-Time Unlocks -->
        <section class="bundles-section">
          <h2 class="section-title">Feature Unlocks</h2>
          <p class="section-subtitle">One-time purchases — no subscription</p>

          <div class="unlocks-grid">
            <GlassCard
              v-for="bundle in unlockBundles"
              :key="bundle.id"
              padding="lg"
              class="bundle-card unlock-card"
              :class="{ owned: isUnlockOwned(bundle) }"
            >
              <div v-if="isUnlockOwned(bundle)" class="owned-badge">
                <Check :size="12" /> Owned
              </div>
              <div class="bundle-icon unlock-icon">
                <Palette :size="32" />
              </div>
              <div class="unlock-label">{{ bundle.label }}</div>
              <p class="unlock-description">{{ bundle.description }}</p>
              <div class="bundle-price">{{ bundle.price }}</div>
              <button
                class="purchase-btn"
                :disabled="isUnlockOwned(bundle)"
                @click="promptPurchase(bundle)"
              >
                {{ isUnlockOwned(bundle) ? 'Owned' : 'Purchase' }}
              </button>
            </GlassCard>
          </div>
        </section>

        <!-- Restore Purchases — Apple guideline 3.1.1 for non-consumable IAPs -->
        <section class="restore-section">
          <button class="restore-btn" :disabled="restoring" @click="restorePurchases">
            <RotateCcw :size="14" />
            {{ restoring ? 'Restoring...' : 'Restore Purchases' }}
          </button>
        </section>
      </div>
    </main>

    <!-- Purchase Confirmation Modal -->
    <BaseModal
      :show="!!confirmBundle"
      title="Confirm Purchase"
      size="sm"
      :closable="!purchasing"
      @close="cancelPurchase"
    >
      <div v-if="confirmBundle" class="confirm-content">
        <div class="confirm-icon" :class="{ unlock: confirmBundle.kind === 'unlock' }">
          <component :is="confirmBundle.kind === 'unlock' ? Palette : Coins" :size="36" />
        </div>
        <div class="confirm-amount">{{ confirmBundle.label }}</div>
        <div class="confirm-label">
          {{ confirmBundle.kind === 'unlock' ? 'One-Time Unlock' : 'Award Tokens' }}
        </div>
        <div class="confirm-price">{{ confirmBundle.price }}</div>
        <div v-if="confirmBundle.kind === 'tokens'" class="confirm-balance">
          Balance after purchase: <strong>{{ (tokenBalance + confirmBundle.amount).toLocaleString() }}</strong>
        </div>
        <div v-else class="confirm-balance">
          {{ confirmBundle.description }}
        </div>
      </div>

      <template #footer>
        <div class="confirm-footer">
          <button class="btn-cancel" :disabled="purchasing" @click="cancelPurchase">
            Cancel
          </button>
          <button class="btn-confirm" :disabled="purchasing" @click="confirmPurchase">
            {{ purchasing ? 'Redirecting...' : 'Continue to Checkout' }}
          </button>
        </div>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.store-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Header */
.store-header {
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--glass-border);
  position: sticky;
  top: 0;
  z-index: 40;
  backdrop-filter: blur(12px);
}

.header-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 1rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.back-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: var(--color-text-secondary);
  background: var(--color-bg-tertiary);
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-link:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.page-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
  flex: 1;
}

.header-spacer {
  width: 36px;
}

/* Main Content */
.store-main {
  flex: 1;
  padding: 1.5rem;
}

.store-container {
  max-width: 800px;
  margin: 0 auto;
}

/* Test Banner */
.test-banner {
  background: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.25);
  color: #fbbf24;
  padding: 8px 16px;
  border-radius: var(--radius-lg);
  font-size: 0.8rem;
  font-weight: 600;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 1.5rem;
}

/* Balance Section */
.balance-section {
  margin-bottom: 2rem;
}

.balance-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
}

.balance-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-xl);
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: white;
  flex-shrink: 0;
}

.balance-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.balance-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}

.balance-amount {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2rem;
  line-height: 1;
  color: var(--color-text-primary);
}

/* Bundles Section */
.bundles-section {
  margin-bottom: 2rem;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-secondary);
  margin-bottom: 0.25rem;
}

.section-subtitle {
  font-size: 0.85rem;
  color: var(--color-text-tertiary);
  margin-bottom: 1.25rem;
}

.bundles-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

.unlocks-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}

.unlock-card {
  align-items: flex-start;
  text-align: left;
}

.unlock-card.owned {
  opacity: 0.7;
}

.owned-badge {
  position: absolute;
  top: -10px;
  right: -8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: #052e16;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 3px 10px;
  border-radius: 20px;
}

.unlock-icon {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(124, 58, 237, 0.1));
  color: #a855f7;
}

.unlock-label {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.4rem;
  line-height: 1.1;
  color: var(--color-text-primary);
  margin-bottom: 0.5rem;
}

.unlock-description {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin: 0 0 1rem;
  line-height: 1.4;
}

.restore-section {
  display: flex;
  justify-content: center;
  margin-top: 1.5rem;
  margin-bottom: 1rem;
}

.restore-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: color 0.2s ease, border-color 0.2s ease;
}

.restore-btn:hover:not(:disabled) {
  color: var(--color-text-primary);
  border-color: var(--color-text-secondary);
}

.restore-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.confirm-icon.unlock {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(124, 58, 237, 0.1));
  color: #a855f7;
}

.bundle-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  position: relative;
  overflow: visible;
}

.bundle-card.best-value {
  border-color: rgba(245, 158, 11, 0.3);
}

.best-value-badge {
  position: absolute;
  top: -10px;
  right: -8px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #1a1520;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 3px 10px;
  border-radius: 20px;
}

.bundle-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(217, 119, 6, 0.1));
  color: #f59e0b;
  margin-bottom: 0.75rem;
}

.bundle-amount {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2rem;
  line-height: 1;
  color: var(--color-text-primary);
  margin-bottom: 0.125rem;
}

.bundle-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary);
  margin-bottom: 0.75rem;
}

.bundle-price {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin-bottom: 1rem;
}

.purchase-btn {
  width: 100%;
  padding: 10px 20px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: var(--radius-lg);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.purchase-btn:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.purchase-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Confirmation Modal */
.confirm-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 0.5rem 0;
}

.confirm-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(217, 119, 6, 0.1));
  color: #f59e0b;
  margin-bottom: 1rem;
}

.confirm-amount {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2.25rem;
  line-height: 1;
  color: var(--color-text-primary);
  margin-bottom: 0.125rem;
}

.confirm-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary);
  margin-bottom: 0.75rem;
}

.confirm-price {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin-bottom: 1rem;
}

.confirm-balance {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-lg);
}

.confirm-balance strong {
  color: #f59e0b;
}

.confirm-footer {
  display: flex;
  gap: 12px;
}

.confirm-footer .btn-cancel,
.confirm-footer .btn-confirm {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  border-radius: var(--radius-xl);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.confirm-footer .btn-cancel {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.confirm-footer .btn-cancel:hover:not(:disabled) {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

.confirm-footer .btn-confirm {
  background: var(--color-primary);
  border: none;
  color: white;
}

.confirm-footer .btn-confirm:hover:not(:disabled) {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.confirm-footer .btn-cancel:disabled,
.confirm-footer .btn-confirm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Responsive */
@media (max-width: 480px) {
  .bundles-grid {
    grid-template-columns: 1fr;
  }

  .balance-amount {
    font-size: 1.75rem;
  }
}
</style>
