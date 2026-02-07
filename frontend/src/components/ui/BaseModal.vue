<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { X } from 'lucide-vue-next'

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
  }
})

const emit = defineEmits(['close'])

function close() {
  if (props.closable) {
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
        class="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
        style="background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px);"
        @click.self="close"
      >
        <div
          :class="[
            'modal-container glass-card-elevated w-full',
            sizeClasses[size]
          ]"
          style="max-height: 90vh; overflow-y: auto;"
        >
          <!-- Header -->
          <header v-if="title || closable" class="flex items-center justify-between p-4 border-b border-white/10">
            <h2 v-if="title" class="h4 text-gradient">{{ title }}</h2>
            <button
              v-if="closable"
              class="btn-ghost btn-icon-sm rounded-full"
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
.modal-container {
  animation: scaleIn var(--duration-normal) var(--ease-out);
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
</style>
