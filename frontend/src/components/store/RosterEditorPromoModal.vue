<script setup>
import { ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { Check, ClipboardList, Users, Sparkles } from 'lucide-vue-next'
import { BaseModal } from '@/components/ui'
import { useAuthStore } from '@/stores/auth'
import * as iap from '@/services/iap'

// Upsell popup for the custom_roster_unlock IAP (Roster Editor + rookie draft
// classes + standalone Builder). Dumb by design, mirroring
// HeadshotEditorPromoModal: the parent owns the weekly gating and navigation;
// this component only renders and reports clicks ('unlock' → parent
// deep-links to the Store's confirm modal).
const props = defineProps({
  show: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'unlock'])

const authStore = useAuthStore()

const icons = [Users, ClipboardList, Sparkles]

const perks = [
  'Edit all 30 teams before the season — players, attributes, badges & coaches',
  'NEW: author full rookie draft classes for any season, or import them from the Community',
  'Standalone Builder — craft rosters & draft classes outside your campaigns and share them',
  'One-time purchase — yours in every campaign, forever'
]

// Live price is a nice-to-have: render immediately with the fallback and swap
// in the RevenueCat price if/when it responds (native only — the web Stripe
// checkout page shows the authoritative price itself).
const FALLBACK_PRICE = '$8.99'
const price = ref(FALLBACK_PRICE)

watch(() => props.show, async (open) => {
  if (!open || !Capacitor.isNativePlatform()) return
  try {
    if (authStore.user?.id) await iap.initIAP(authStore.user.id)
    const prices = await iap.getProductPrices()
    if (prices?.custom_roster_unlock) price.value = prices.custom_roster_unlock
  } catch {
    /* keep fallback */
  }
})
</script>

<template>
  <BaseModal :show="show" size="sm" :show-header="false" @close="emit('close')">
    <div class="promo-content">
      <div class="promo-icons">
        <div
          v-for="(icon, i) in icons"
          :key="i"
          class="promo-icon"
          :style="{ zIndex: icons.length - i }"
        >
          <component :is="icon" :size="22" />
        </div>
      </div>

      <h2 class="promo-headline">{{ $t('Build Your Own League') }}</h2>
      <p class="promo-subhead">
        {{ $t('Author every roster — and now every rookie draft class — with the Roster Editor.') }}
      </p>

      <ul class="promo-perks">
        <li v-for="perk in perks" :key="perk">
          <Check :size="16" class="perk-check" />
          <span>{{ $tDynamic(perk) }}</span>
        </li>
      </ul>

      <button class="promo-cta" @click="emit('unlock')">
        {{ $t('Unlock for {price}', { price }) }}
      </button>
      <button class="promo-later" @click="emit('close')">
        {{ $t('Maybe later') }}
      </button>
    </div>
  </BaseModal>
</template>

<style scoped>
.promo-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 0.75rem 0.25rem 0.25rem;
}

/* Overlapping icon trio, mirroring the headshot promo's face row */
.promo-icons {
  display: flex;
  align-items: center;
  margin-bottom: 1rem;
}

.promo-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid rgba(232, 90, 79, 0.35);
  background: linear-gradient(135deg, rgba(232, 90, 79, 0.2), rgba(244, 162, 89, 0.12));
  color: var(--color-primary, #e85a4f);
  flex-shrink: 0;
}

.promo-icon + .promo-icon {
  margin-left: -14px;
}

.promo-headline {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.75rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  line-height: 1.1;
  color: var(--color-text-primary);
  margin: 0 0 0.375rem;
}

.promo-subhead {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  line-height: 1.45;
  margin: 0 0 1rem;
  max-width: 320px;
}

.promo-perks {
  list-style: none;
  margin: 0 0 1.25rem;
  padding: 0.875rem 1rem;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  text-align: left;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-lg);
}

.promo-perks li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.8rem;
  line-height: 1.4;
  color: var(--color-text-secondary);
}

.perk-check {
  color: var(--color-primary, #e85a4f);
  flex-shrink: 0;
  margin-top: 1px;
}

.promo-cta {
  width: 100%;
  padding: 12px 20px;
  border: none;
  border-radius: var(--radius-xl);
  background: var(--gradient-cosmic, linear-gradient(135deg, #7c3aed, #a855f7));
  color: #000;
  font-size: 0.9rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: filter 0.2s ease, transform 0.2s ease;
}

.promo-cta:hover {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.promo-later {
  margin-top: 0.625rem;
  background: transparent;
  border: none;
  color: var(--color-text-tertiary);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  padding: 6px 12px;
  transition: color 0.2s ease;
}

.promo-later:hover {
  color: var(--color-text-primary);
}
</style>
