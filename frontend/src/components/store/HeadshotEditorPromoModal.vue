<script setup>
import { ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { Check, Palette } from 'lucide-vue-next'
import { BaseModal } from '@/components/ui'
import { useAuthStore } from '@/stores/auth'
import * as iap from '@/services/iap'
import face1 from '@/assets/headshots-premade/premade_005.svg'
import face2 from '@/assets/headshots-premade/premade_007.svg'
import face3 from '@/assets/headshots-premade/premade_009.svg'

// Upsell popup for the headshot_editor_unlock IAP. Dumb by design: the parent
// owns the weekly gating and navigation; this component only renders and
// reports clicks ('unlock' → parent deep-links to the Store's confirm modal).
const props = defineProps({
  show: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'unlock'])

const authStore = useAuthStore()

const faces = [face1, face2, face3]

const perks = [
  'Custom headshots for every player, coach & staff member',
  'Rename your team when starting a campaign',
  'New styles, faces & assets added regularly — owners get them all, free',
  'One-time purchase — yours in every campaign, forever'
]

// Live price is a nice-to-have: render immediately with the fallback and swap
// in the RevenueCat price if/when it responds (native only — the web Stripe
// checkout page shows the authoritative price itself). initIAP is needed here
// because unlike StoreView this modal can be the first RC touchpoint of the
// session; it's idempotent.
const FALLBACK_PRICE = '$3.99'
const price = ref(FALLBACK_PRICE)

watch(() => props.show, async (open) => {
  if (!open || !Capacitor.isNativePlatform()) return
  try {
    if (authStore.user?.id) await iap.initIAP(authStore.user.id)
    const prices = await iap.getProductPrices()
    if (prices?.headshot_editor_unlock) price.value = prices.headshot_editor_unlock
  } catch {
    /* keep fallback */
  }
})
</script>

<template>
  <BaseModal :show="show" size="sm" :show-header="false" @close="emit('close')">
    <div class="promo-content">
      <div class="promo-faces">
        <div
          v-for="(face, i) in faces"
          :key="i"
          class="promo-face"
          :style="{ zIndex: faces.length - i }"
        >
          <img :src="face" alt="" />
        </div>
        <div class="promo-face promo-face-icon">
          <Palette :size="22" />
        </div>
      </div>

      <h2 class="promo-headline">Make the League Yours</h2>
      <p class="promo-subhead">
        Give every face in your franchise a look of its own with the Headshot Editor.
      </p>

      <ul class="promo-perks">
        <li v-for="perk in perks" :key="perk">
          <Check :size="16" class="perk-check" />
          <span>{{ perk }}</span>
        </li>
      </ul>

      <button class="promo-cta" @click="emit('unlock')">
        Unlock for {{ price }}
      </button>
      <button class="promo-later" @click="emit('close')">
        Maybe later
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

/* Overlapping row of sample faces + the editor icon */
.promo-faces {
  display: flex;
  align-items: center;
  margin-bottom: 1rem;
}

.promo-face {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid var(--glass-border);
  background: var(--color-bg-tertiary);
  flex-shrink: 0;
}

.promo-face + .promo-face {
  margin-left: -14px;
}

.promo-face img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.promo-face-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(124, 58, 237, 0.15));
  color: #a855f7;
  border-color: rgba(168, 85, 247, 0.35);
  z-index: 4;
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
  color: #a855f7;
  flex-shrink: 0;
  margin-top: 1px;
}

.promo-cta {
  width: 100%;
  padding: 12px 20px;
  border: none;
  border-radius: var(--radius-xl);
  background: var(--gradient-cosmic, linear-gradient(135deg, #7c3aed, #a855f7));
  color: white;
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
