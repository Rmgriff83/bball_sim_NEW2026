<script setup>
import { useToastStore } from '@/stores/toast'
import { Loader2 } from 'lucide-vue-next'

const toastStore = useToastStore()
</script>

<template>
  <Teleport to="body">
    <div class="minimal-toast-container">
      <TransitionGroup name="slide-right">
        <div
          v-for="toast in toastStore.minimalToasts"
          :key="toast.id"
          class="minimal-toast"
          :class="[`toast-${toast.type}`]"
        >
          <Loader2
            v-if="toast.type === 'loading'"
            :size="12"
            class="toast-spinner"
          />
          <span class="toast-message">{{ toast.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.minimal-toast-container {
  position: fixed;
  bottom: 90px;
  right: 12px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

@media (min-width: 1024px) {
  .minimal-toast-container {
    bottom: 24px;
  }
}

.minimal-toast {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-md);
  white-space: nowrap;
}

.toast-loading {
  background: var(--color-success);
}

.toast-loading .toast-spinner {
  color: white;
}

.toast-loading .toast-message {
  color: white;
}

.toast-success {
  background: var(--color-success);
}

.toast-success .toast-message {
  color: white;
}

.toast-error {
  background: var(--color-error);
}

.toast-error .toast-spinner {
  color: white;
}

.toast-error .toast-message {
  color: white;
}

.toast-spinner {
  flex-shrink: 0;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.toast-message {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

/* Slide in from bottom animation */
.slide-right-enter-active {
  animation: slideInBottom 0.25s ease-out;
}

.slide-right-leave-active {
  animation: slideOutBottom 0.2s ease-in;
}

@keyframes slideInBottom {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slideOutBottom {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(20px);
  }
}
</style>
