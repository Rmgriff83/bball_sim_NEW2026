<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { X } from 'lucide-vue-next'
import { useAudioStore } from '@/stores/audio'

const audio = useAudioStore()

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: ''
  },
  size: {
    type: String,
    default: 'md',
    validator: (value) => ['sm', 'md', 'lg', 'xl', 'full'].includes(value)
  },
  closable: {
    type: Boolean,
    default: true
  },
  showHeader: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['close'])

function close() {
  if (props.closable) {
    audio.cancel()
    emit('close')
  }
}

function handleKeydown(e) {
  if (e.key === 'Escape' && props.closable) {
    close()
  }
}

watch(() => props.show, (isOpen) => {
  if (isOpen) {
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.body.style.overflow = ''
    document.removeEventListener('keydown', handleKeydown)
  }
})

onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', handleKeydown)
})

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-full mx-4'
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="show"
        class="modal-overlay fixed inset-0 z-50 flex items-center justify-center"
        style="background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px);"
        @click.self="close"
      >
        <div
          :class="[
            'modal-container glass-card-elevated w-full',
            sizeClasses[size]
          ]"
          style="overflow-y: auto;"
        >
          <!-- Header -->
          <header v-if="showHeader && (title || closable)" class="modal-header">
            <h2 v-if="title" class="modal-title">{{ title }}</h2>
            <button
              v-if="closable"
              class="btn-close"
              @click="close"
              aria-label="Close"
            >
              <X :size="20" />
            </button>
          </header>

          <!-- Content -->
          <main class="p-4">
            <slot />
          </main>

          <!-- Footer (optional) -->
          <footer v-if="$slots.footer" class="p-4 border-t border-white/10">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Replace Tailwind p-4 with safe-area-aware padding so the modal can never
   render under the notch / home indicator on iPhone. max() keeps the
   minimum 16px gutter on devices without insets. */
.modal-overlay {
  padding-top: max(16px, env(safe-area-inset-top));
  padding-right: max(16px, env(safe-area-inset-right));
  padding-bottom: max(16px, env(safe-area-inset-bottom));
  padding-left: max(16px, env(safe-area-inset-left));
}

.modal-container {
  animation: scaleIn var(--duration-normal) var(--ease-out);
  max-height: 90vh;
}

@media (max-width: 480px) {
  .modal-container {
    max-height: 85vh;
  }
}

@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
}

.modal-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  letter-spacing: 0.02em;
  text-transform: none;
}

.btn-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  border-radius: var(--radius-full);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}
</style>
