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
import { t } from '@wl-i18n/i18n.js'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const toastStore = useToastStore()

const purchasing = ref(false)
const restoring = ref(false)
const confirmBundle = ref(null)

// Live prices fetched from RevenueCat (App Store Connect-driven) on mount.
// Keyed by product id — empty until the offering loads. The `priceFor`
// helper below picks the live value when available and falls back to the
// hardcoded `bundle.price` placeholder, so an offline / un-configured /
// SDK-errored state just keeps showing the static catalog price.
const livePrices = ref({})

function priceFor(bundle) {
  if (!bundle) return ''
  return livePrices.value[bundle.id] || bundle.price
}

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
  const fulfilled = () => {
    if (isUnlock && bundle.feature) return !hadFeature && authStore.hasFeature(bundle.feature)
    return (authStore.profile?.tokens ?? 0) > beforeTokens
  }
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try { await authStore.fetchUser() } catch { /* network blip — retry */ }
    if (fulfilled()) return true
    if (i < MAX_ATTEMPTS - 1) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS))
    }
  }
  return false
}

// Detached long-tail poll for slow webhooks (Apple SANDBOX server-to-server
// notifications routinely take 30s+; production spikes happen too). Runs
// AFTER the blocking wait gave up, without holding the purchase spinner:
// up to ~100 more seconds of gentle fetchUser polling, then a success toast
// when the credit finally lands so the user gets closure. Best-effort and
// single-flight; the app-resume profile refresh (App.vue) is the final
// backstop if the app backgrounds before this finishes.
let _slowFulfillmentPolling = false
function _pollSlowFulfillment(bundle, beforeTokens, successMessage) {
  if (_slowFulfillmentPolling) return
  _slowFulfillmentPolling = true
  const isUnlock = bundle.kind === 'unlock'
  const hadFeature = isUnlock && bundle.feature
    ? authStore.hasFeature(bundle.feature)
    : false
  const fulfilled = () => {
    if (isUnlock && bundle.feature) return !hadFeature && authStore.hasFeature(bundle.feature)
    return (authStore.profile?.tokens ?? 0) > beforeTokens
  }
  ;(async () => {
    try {
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 5000))
        try { await authStore.fetchUser() } catch { /* keep polling */ }
        if (fulfilled()) {
          toastStore.showSuccess(successMessage)
          return
        }
      }
    } finally {
      _slowFulfillmentPolling = false
    }
  })()
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
    price: '$3.99',
    label: 'Headshot Editor',
    description: 'Unlock full headshot customization for every player, coach, and staff member — plus team renaming on campaign creation. New styles, faces, and assets are added regularly, and owners get every drop free. One-time purchase, applies across all your campaigns.'
  },
  {
    id: 'custom_roster_unlock',
    kind: 'unlock',
    feature: 'custom_roster',
    price: '$8.99',
    label: 'Roster Editor',
    description: 'Build your own league. When you start a new campaign, choose the Custom roster option to edit every team — players, attributes, growth potential, badges, names, and head coaches — before the season begins. Start from a generated league and tweak it, or build every team from scratch. NEW: author full rookie draft classes for any season (or import them from the Community board), and craft rosters & classes anytime in the standalone Builder. One-time purchase, applies to all future campaigns.'
  }
]

function isUnlockOwned(bundle) {
  return bundle.kind === 'unlock' && authStore.hasFeature(bundle.feature)
}

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
        toastStore.showError(t('Could not restore purchases.'))
        return
      }
    }
    // Always re-fetch the profile — web purchases land via webhook and are
    // recovered just by re-reading the user record.
    try {
      await authStore.fetchUser()
    } catch {}
    toastStore.showSuccess(t('Purchases restored.'))
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
    ? t('Purchase complete! Feature unlocked.')
    : t('Purchase complete! Tokens added to your account.')

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
      const landed = await _waitForFulfillment(bundle, beforeTokens)
      if (landed) {
        toastStore.showSuccess(successMessage)
      } else {
        // Webhook slower than the ~12s blocking window (routine in the Apple
        // sandbox): reassure now, keep polling in the background, and let the
        // success toast fire when the credit actually lands.
        toastStore.showSuccess(isUnlock
          ? t('Purchase confirmed! Your unlock is on the way — it will activate in a moment.')
          : t('Purchase confirmed! Your tokens are on the way — they will appear in a moment.'))
        _pollSlowFulfillment(bundle, beforeTokens, successMessage)
      }
      confirmBundle.value = null
    } catch (err) {
      console.error('IAP purchase failed', err)
      // Surface the RevenueCat error code/message so store failures are
      // diagnosable on-device (Play billing rejects have distinct codes:
      // e.g. PRODUCT_NOT_AVAILABLE, PURCHASE_NOT_ALLOWED, STORE_PROBLEM).
      const code = err?.code ?? err?.errorCode ?? null
      const detail = err?.underlyingErrorMessage || err?.message || ''
      toastStore.showError(
        `${t('Purchase failed')}${code != null ? ` [${code}]` : ''}${detail ? `: ${detail}` : `. ${t('Please try again.')}`}`
      )
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
    toastStore.showError(t('Could not start checkout. Please try again.'))
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
    // Pull live prices from the configured RevenueCat offering so a
    // catalog price change in App Store Connect propagates here without
    // a code edit / resubmission. Failure is silent — the hardcoded
    // `bundle.price` strings remain visible as fallback.
    try {
      const prices = await iap.getProductPrices()
      if (prices && typeof prices === 'object') {
        livePrices.value = prices
      }
    } catch (err) {
      console.warn('getProductPrices failed; using hardcoded placeholders', err)
    }
  }

  // Web only — Stripe redirects back to /store?checkout=success or
  // ?checkout=cancel after the hosted checkout flow.
  const status = route.query.checkout
  if (status === 'success') {
    try {
      await authStore.fetchUser()
    } catch {}
    toastStore.showSuccess(t('Purchase complete!'))
    router.replace({ query: {} })
  } else if (status === 'cancel') {
    toastStore.showError(t('Purchase canceled.'))
    router.replace({ query: {} })
  }

  // Deep-link straight into the confirm modal (e.g. /store?buy=headshot_editor_unlock
  // from the upsell popup). Runs after the price load so the modal shows the live
  // price on native, and skips when returning from Stripe checkout above. Unknown
  // ids do nothing; owned unlocks no-op inside promptPurchase. The query is always
  // stripped so refresh/back can't re-open the modal.
  const buyId = route.query.buy
  if (buyId && !status) {
    const bundle = [...tokenBundles, ...unlockBundles].find(b => b.id === buyId)
    if (bundle) promptPurchase(bundle)
    router.replace({ query: { ...route.query, buy: undefined } })
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
        <h1 class="page-title">{{ $t('Store') }}</h1>
        <div class="header-spacer" />
      </div>
    </header>

    <!-- Main Content -->
    <main class="store-main">
      <div class="store-container">

        <!-- Token Balance -->
        <div class="balance-section">
          <div class="balance-card">
            <div class="balance-icon">
              <Coins :size="24" />
            </div>
            <div class="balance-info">
              <span class="balance-label">{{ $t('Your Balance') }}</span>
              <span class="balance-amount">{{ tokenBalance.toLocaleString() }}</span>
            </div>
          </div>
        </div>

        <!-- Token Bundles -->
        <section class="bundles-section">
          <h2 class="section-title">{{ $t('Award Tokens') }}</h2>
          <p class="section-subtitle">{{ $t('Use tokens to upgrade facilities, hire scouts, and more') }}</p>

          <div class="bundles-grid">
            <GlassCard
              v-for="bundle in tokenBundles"
              :key="bundle.id"
              padding="lg"
              class="bundle-card"
              :class="{ 'best-value': bundle.bestValue }"
            >
              <div v-if="bundle.bestValue" class="best-value-badge">{{ $t('Best Value') }}</div>
              <div class="bundle-icon">
                <Coins :size="32" />
              </div>
              <div class="bundle-amount">{{ bundle.label }}</div>
              <div class="bundle-label">{{ $t('Award Tokens') }}</div>
              <div class="bundle-price">{{ priceFor(bundle) }}</div>
              <button
                class="purchase-btn"
                @click="promptPurchase(bundle)"
              >
                {{ $t('Purchase') }}
              </button>
            </GlassCard>
          </div>
        </section>

        <!-- One-Time Unlocks -->
        <section class="bundles-section">
          <h2 class="section-title">{{ $t('Feature Unlocks') }}</h2>
          <p class="section-subtitle">{{ $t('One-time purchases — no subscription') }}</p>

          <div class="unlocks-grid">
            <GlassCard
              v-for="bundle in unlockBundles"
              :key="bundle.id"
              padding="lg"
              class="bundle-card unlock-card"
              :class="{ owned: isUnlockOwned(bundle) }"
            >
              <div v-if="isUnlockOwned(bundle)" class="owned-badge">
                <Check :size="12" /> {{ $t('Owned') }}
              </div>
              <div class="bundle-icon unlock-icon">
                <Palette :size="32" />
              </div>
              <div class="unlock-label">{{ $tDynamic(bundle.label) }}</div>
              <p class="unlock-description">{{ $tDynamic(bundle.description) }}</p>
              <div class="bundle-price">{{ priceFor(bundle) }}</div>
              <button
                class="purchase-btn"
                :disabled="isUnlockOwned(bundle)"
                @click="promptPurchase(bundle)"
              >
                {{ isUnlockOwned(bundle) ? $t('Owned') : $t('Purchase') }}
              </button>
            </GlassCard>
          </div>
        </section>

        <!-- Restore Purchases — Apple guideline 3.1.1 for non-consumable IAPs -->
        <section class="restore-section">
          <button class="restore-btn" :disabled="restoring" @click="restorePurchases">
            <RotateCcw :size="14" />
            {{ restoring ? $t('Restoring...') : $t('Restore Purchases') }}
          </button>
        </section>
      </div>
    </main>

    <!-- Purchase Confirmation Modal -->
    <BaseModal
      :show="!!confirmBundle"
      :title="$t('Confirm Purchase')"
      size="sm"
      :closable="!purchasing"
      @close="cancelPurchase"
    >
      <div v-if="confirmBundle" class="confirm-content">
        <div class="confirm-icon" :class="{ unlock: confirmBundle.kind === 'unlock' }">
          <component :is="confirmBundle.kind === 'unlock' ? Palette : Coins" :size="36" />
        </div>
        <div class="confirm-amount">{{ $tDynamic(confirmBundle.label) }}</div>
        <div class="confirm-label">
          {{ confirmBundle.kind === 'unlock' ? $t('One-Time Unlock') : $t('Award Tokens') }}
        </div>
        <div class="confirm-price">{{ priceFor(confirmBundle) }}</div>
        <div v-if="confirmBundle.kind === 'tokens'" class="confirm-balance">
          {{ $t('Balance after purchase:') }} <strong>{{ (tokenBalance + confirmBundle.amount).toLocaleString() }}</strong>
        </div>
        <div v-else class="confirm-balance">
          {{ $tDynamic(confirmBundle.description) }}
        </div>
      </div>

      <template #footer>
        <div class="confirm-footer">
          <button class="btn-cancel" :disabled="purchasing" @click="cancelPurchase">
            {{ $t('Cancel') }}
          </button>
          <button class="btn-confirm" :disabled="purchasing" @click="confirmPurchase">
            {{ purchasing ? $t('Redirecting...') : $t('Continue to Checkout') }}
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
  /* Bottom padding clears the floating mobile nav (70px tall, sits at
     var(--safe-area-inset-bottom, env(safe-area-inset-bottom))) with 16px breathing room. The shorthand
     covers top/horizontal at the normal 1.5rem while the bottom takes
     the larger calc value. */
  padding: 1.5rem 1.5rem calc(70px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + 16px);
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
