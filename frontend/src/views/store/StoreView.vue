<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { GlassCard, BaseModal } from '@/components/ui'
import { ArrowLeft, Coins, ShoppingBag } from 'lucide-vue-next'
import api from '@/composables/useApi'

const router = useRouter()
const authStore = useAuthStore()
const toastStore = useToastStore()

const purchasing = ref(false)
const confirmBundle = ref(null)

const tokenBalance = computed(() => authStore.profile?.tokens ?? 0)

const bundles = [
  { id: 'tokens_1000', amount: 1000, price: '$0.99', label: '1,000' },
  { id: 'tokens_6500', amount: 6500, price: '$4.99', label: '6,500', bestValue: true }
]

function isNative() {
  return false
}

function promptPurchase(bundle) {
  confirmBundle.value = bundle
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

  try {
    if (isNative()) {
      // Future: RevenueCat IAP integration
      // await Purchases.purchasePackage(bundle.id)
    }

    // Test mode: directly credit tokens via API
    const response = await api.post('/api/user/tokens', { amount: bundle.amount })
    if (authStore.profile) {
      authStore.profile.tokens = response.data.tokens
    }
    confirmBundle.value = null
    toastStore.showSuccess(`${bundle.label} tokens added!`)
  } catch (error) {
    toastStore.showError('Purchase failed. Please try again.')
  } finally {
    purchasing.value = false
  }
}
</script>

<template>
  <div class="store-page">
    <!-- Header -->
    <header class="store-header">
      <div class="header-container">
        <button class="back-link" @click="router.back()">
          <ArrowLeft :size="20" />
        </button>
        <h1 class="page-title">Store</h1>
        <div class="header-spacer" />
      </div>
    </header>

    <!-- Main Content -->
    <main class="store-main">
      <div class="store-container">
        <!-- Test Mode Banner -->
        <div class="test-banner">
          Test Mode — No real charges
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
              v-for="bundle in bundles"
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
        <div class="confirm-icon">
          <Coins :size="36" />
        </div>
        <div class="confirm-amount">{{ confirmBundle.label }}</div>
        <div class="confirm-label">Award Tokens</div>
        <div class="confirm-price">{{ confirmBundle.price }}</div>
        <div class="confirm-balance">
          Balance after purchase: <strong>{{ (tokenBalance + confirmBundle.amount).toLocaleString() }}</strong>
        </div>
      </div>

      <template #footer>
        <div class="confirm-footer">
          <button class="btn-cancel" :disabled="purchasing" @click="cancelPurchase">
            Cancel
          </button>
          <button class="btn-confirm" :disabled="purchasing" @click="confirmPurchase">
            {{ purchasing ? 'Processing...' : 'Confirm Purchase' }}
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
  padding: 12px 20px;
  border-radius: var(--radius-lg);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
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
}

.confirm-footer .btn-confirm {
  background: var(--color-primary);
  border: none;
  color: white;
}

.confirm-footer .btn-confirm:hover:not(:disabled) {
  filter: brightness(1.1);
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
