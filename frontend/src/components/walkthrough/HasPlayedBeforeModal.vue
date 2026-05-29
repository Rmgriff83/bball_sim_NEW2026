<script setup>
import { Sparkles, Trophy } from 'lucide-vue-next'
import BaseModal from '@/components/ui/BaseModal.vue'

// Shown once when a new campaign is created. The answer gates the onboarding
// walkthroughs: NEW players get them, experienced players skip them. Emits the
// boolean "have you played before?" answer so the host can persist it and then
// navigate into the campaign.
defineProps({
  show: { type: Boolean, default: false },
})

const emit = defineEmits(['answered'])
</script>

<template>
  <BaseModal :show="show" size="sm" :closable="false" :show-header="false">
    <div class="hpb">
      <h2 class="hpb-title">Welcome to your dynasty</h2>
      <p class="hpb-subtitle">
        Have you played a basketball management sim like this before?
      </p>

      <div class="hpb-options">
        <button class="hpb-option" @click="emit('answered', false)">
          <span class="hpb-icon hpb-icon-new"><Sparkles :size="22" /></span>
          <span class="hpb-option-label">No, I'm new</span>
          <span class="hpb-option-desc">Show me guided tips as I explore each screen.</span>
        </button>

        <button class="hpb-option" @click="emit('answered', true)">
          <span class="hpb-icon hpb-icon-vet"><Trophy :size="22" /></span>
          <span class="hpb-option-label">Yes, I've played before</span>
          <span class="hpb-option-desc">Skip the tips — I'll dive straight in.</span>
        </button>
      </div>

      <p class="hpb-note">You can skip any tip at any time.</p>
    </div>
  </BaseModal>
</template>

<style scoped>
.hpb {
  text-align: center;
  padding: 8px 4px;
}

.hpb-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.6rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
  margin: 0 0 6px;
}

.hpb-subtitle {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  margin: 0 0 20px;
}

.hpb-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hpb-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 18px 16px;
  background: var(--color-bg-tertiary);
  border: 2px solid var(--glass-border);
  border-radius: var(--radius-xl);
  cursor: pointer;
  transition: all 0.2s ease;
}

.hpb-option:hover {
  border-color: var(--color-primary);
  background: rgba(232, 90, 79, 0.1);
}

.hpb-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-full);
  margin-bottom: 4px;
}

.hpb-icon-new {
  background: var(--gradient-cosmic);
  color: #1a1520;
}

.hpb-icon-vet {
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
}

.hpb-option-label {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.hpb-option-desc {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.hpb-note {
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
  margin: 16px 0 0;
}
</style>

<!-- Cap the width of BaseModal's container for this modal only. BaseModal's
     `size` classes are Tailwind-style utilities that aren't defined in this
     project, so without this the container stretches near full-width. Scoped to
     just our content via :has() so other BaseModals are unaffected. -->
<style>
.modal-container:has(.hpb) {
  max-width: 42rem;
}
</style>
