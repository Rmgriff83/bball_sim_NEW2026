<script setup>
import { useToastStore } from '@/stores/toast'
import { Loader2 } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'

const toastStore = useToastStore()

// Dismiss the toast when its link is clicked. Without this, navigating
// away would still leave the toast in the queue until its duration
// elapses, which feels stale once the user has already engaged.
function handleLinkClick(toast) {
  toastStore.removeMinimalToast(toast.id)
}
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
            v-if="toast.type === 'loading' || toast.type === 'progress'"
            :size="12"
            class="toast-spinner"
          />
          <span class="toast-message">{{ toast.message }}</span>
          <template v-if="toast.type === 'progress' && toast.total > 0">
            <span class="toast-progress-count">{{ toast.completed }}/{{ toast.total }}</span>
            <div class="toast-progress-bar">
              <div class="toast-progress-fill" :style="{ width: `${(toast.completed / toast.total) * 100}%` }"></div>
            </div>
          </template>
          <RouterLink
            v-if="toast.link && toast.link.to"
            :to="toast.link.to"
            class="toast-link"
            @click="handleLinkClick(toast)"
          >{{ toast.link.label || 'View' }}</RouterLink>
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

.toast-progress {
  background: var(--color-surface-elevated, #1a1a2e);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.toast-progress .toast-spinner {
  color: var(--color-accent, #60a5fa);
}

.toast-progress .toast-message {
  color: rgba(255, 255, 255, 0.9);
}

.toast-progress-count {
  font-size: 10px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.6);
  font-variant-numeric: tabular-nums;
}

.toast-progress-bar {
  width: 48px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.toast-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--color-accent, #60a5fa);
  transition: width 0.3s ease;
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

.toast-link {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: white;
  text-decoration: underline;
  text-underline-offset: 2px;
  padding-left: 4px;
}

.toast-link:hover {
  opacity: 0.85;
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

<!-- Native override: clear the floating glass bottom nav
     (bottom: env(safe-area-inset-bottom), 70px tall) with a 12px gap above.
     Applies to both native platforms (nav renders on Android too). Non-scoped
     block — `html.platform-*` is set globally on <html> by main.js. Browser
     builds keep the existing 90px bottom. -->
<style>
@media (max-width: 1023px) {
  html.platform-ios .minimal-toast-container,
  html.platform-android .minimal-toast-container {
    bottom: calc(70px + env(safe-area-inset-bottom) + 12px);
  }
}
</style>
