<script setup>
import { ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { Heart, MessageCircle, Star, Send } from 'lucide-vue-next'
import BaseModal from '@/components/ui/BaseModal.vue'
import { useReviewNagStore } from '@/stores/reviewNag'
import { openStore } from '@/services/appUpdate'
import { requestInAppReview, writeReviewUrl, sendFeedbackEmail } from '@/services/appReview'
import { useAudioStore } from '@/stores/audio'

// One-time review nag — see stores/reviewNag.js for the show-once contract.
// Three steps: ask → loving (native in-app rating + write-review link) or
// feedback (compose an email to support).
const store = useReviewNagStore()
const audio = useAudioStore()

const feedbackText = ref('')
const ratingBusy = ref(false)

async function rateNow() {
  if (ratingBusy.value) return
  ratingBusy.value = true
  try {
    // iOS rations SKStoreReviewController (~3/yr) and a resolved plugin call
    // doesn't mean the sheet displayed — deep-link to the App Store review
    // composer instead so the tap always visibly lands. Android's Play
    // in-app widget is reliable, so it keeps the native flow (web / plugin
    // failure / pre-plugin binary all fall back to the store page).
    const shown = Capacitor.getPlatform() !== 'ios' && await requestInAppReview()
    if (!shown) openStore(writeReviewUrl())
  } finally {
    ratingBusy.value = false
    store.close()
  }
}

function writeReview() {
  openStore(writeReviewUrl())
  store.close()
}

function sendFeedback() {
  const text = feedbackText.value.trim()
  if (!text) return
  audio.affirm()
  sendFeedbackEmail(text)
  store.close()
}
</script>

<template>
  <BaseModal :show="store.visible" size="sm" :show-header="false" @close="store.close()">
    <div class="rn">
      <!-- Step 1: the ask -->
      <template v-if="store.step === 'ask'">
        <h2 class="rn-title">How are you liking Bball Sim so far?</h2>
        <p class="rn-subtitle">You just wrapped up a full season — nice work, GM.</p>
        <div class="rn-options">
          <button class="rn-option" @click="store.choose('loving')">
            <span class="rn-icon rn-icon-love"><Heart :size="22" /></span>
            <span class="rn-option-label">Loving it!</span>
          </button>
          <button class="rn-option" @click="store.choose('feedback')">
            <span class="rn-icon rn-icon-meh"><MessageCircle :size="22" /></span>
            <span class="rn-option-label">Not so much</span>
          </button>
        </div>
      </template>

      <!-- Step 2a: loving it → rate / review -->
      <template v-else-if="store.step === 'loving'">
        <span class="rn-big-icon"><Star :size="30" /></span>
        <h2 class="rn-title">That's great to hear!</h2>
        <p class="rn-subtitle">
          A quick rating goes a long way for a small indie game. Thank you!
        </p>
        <button class="rn-primary" :disabled="ratingBusy" @click="rateNow">
          <Star :size="16" /> Rate Bball Sim
        </button>
        <button class="rn-ghost" @click="writeReview">Write a review</button>
      </template>

      <!-- Step 2b: not so much → feedback email -->
      <template v-else>
        <h2 class="rn-title">How can we improve the game?</h2>
        <p class="rn-subtitle">
          Your feedback goes straight to the developer — every message gets read.
        </p>
        <textarea
          v-model="feedbackText"
          class="rn-textarea"
          rows="5"
          placeholder="Tell us what's not working for you…"
        ></textarea>
        <button class="rn-primary" :disabled="!feedbackText.trim()" @click="sendFeedback">
          <Send :size="15" /> Send Feedback
        </button>
        <button class="rn-ghost" @click="store.close()">No thanks</button>
      </template>
    </div>
  </BaseModal>
</template>

<style scoped>
.rn {
  text-align: center;
  padding: 8px 4px;
  display: flex;
  flex-direction: column;
}

.rn-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
  margin: 0 0 6px;
}

.rn-subtitle {
  font-size: 0.88rem;
  color: var(--color-text-secondary);
  margin: 0 0 18px;
}

.rn-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rn-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px;
  background: var(--color-bg-tertiary);
  border: 2px solid var(--glass-border);
  border-radius: var(--radius-xl);
  cursor: pointer;
  transition: all 0.2s ease;
}

.rn-option:hover {
  border-color: var(--color-primary);
  background: rgba(232, 90, 79, 0.1);
}

.rn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-full);
  margin-bottom: 4px;
}

.rn-icon-love {
  background: var(--gradient-cosmic);
  color: #1a1520;
}

.rn-icon-meh {
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
}

.rn-option-label {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.rn-big-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  margin: 0 auto 10px;
  border-radius: var(--radius-full);
  background: var(--gradient-cosmic);
  color: #1a1520;
}

.rn-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 96px;
  padding: 10px 12px;
  margin-bottom: 14px;
  border-radius: var(--radius-lg);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
  font-size: 0.9rem;
  font-family: inherit;
}

.rn-textarea:focus {
  outline: none;
  border-color: var(--glass-border-focus);
}

.rn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 12px 18px;
  border: none;
  border-radius: var(--radius-xl);
  background: var(--color-primary);
  color: #fff;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease;
}

.rn-primary:hover:not(:disabled) {
  background: var(--color-primary-light);
}

.rn-primary:disabled {
  opacity: 0.5;
  cursor: default;
}

.rn-ghost {
  margin-top: 10px;
  padding: 8px;
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.rn-ghost:hover {
  color: var(--color-text-primary);
}
</style>

<!-- Same width cap trick HasPlayedBeforeModal uses: BaseModal's size classes
     are Tailwind-style names that aren't defined here, so cap the container
     for this modal's content only. -->
<style>
.modal-container:has(.rn) {
  max-width: 26rem;
  min-height: auto;
}
</style>
