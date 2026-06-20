<script setup>
// A minimal owner "welcome" conversation shown the moment a user accepts a new
// GM job (taking over a new franchise or starting a fresh campaign). Unlike the
// full Owner Check-In, there's no piece-by-piece reveal and no sub-goal
// checklist — just the owner's greeting + mandate (in their tone) and the
// franchise's current expectation, then a single dismiss button.
import { computed, watch, onUnmounted } from 'vue'
import { Crown, ArrowRight } from 'lucide-vue-next'

const props = defineProps({
  show: { type: Boolean, default: false },
  owner: { type: Object, default: null },
  seasonYear: { type: [Number, String], default: null },
  // { label, expectedWins, tier, blurb }
  expectation: { type: Object, default: null },
  lines: { type: Array, default: () => [] },
})
const emit = defineEmits(['close'])

const ownerName = computed(() =>
  props.owner ? `${props.owner.firstName ?? ''} ${props.owner.lastName ?? ''}`.trim() : 'Team Owner'
)

function close() {
  emit('close')
}

function handleKeydown(e) {
  if (e.key === 'Escape') close()
}
watch(() => props.show, (open) => {
  if (open) {
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.body.style.overflow = ''
    document.removeEventListener('keydown', handleKeydown)
  }
}, { immediate: true })
onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay">
        <div class="modal-container">
          <header class="modal-header">
            <div class="hdr-avatar"><Crown :size="22" /></div>
            <div>
              <h2 class="modal-title">Welcome Aboard</h2>
              <p class="modal-sub">
                {{ ownerName }}<span v-if="seasonYear"> · {{ seasonYear }} Season</span>
              </p>
            </div>
          </header>

          <main class="modal-content">
            <p v-if="owner?.blurb" class="owner-blurb">{{ owner.blurb }}</p>

            <div class="chat-log">
              <div v-for="(line, i) in lines" :key="i" class="chat-row">
                <div class="chat-avatar"><Crown :size="14" /></div>
                <div class="chat-bubble">{{ line }}</div>
              </div>
            </div>

            <div v-if="expectation" class="expectation-card">
              <span class="exp-label">Franchise Expectation</span>
              <span class="exp-value">
                {{ expectation.label }}
                <span v-if="expectation.expectedWins != null" class="exp-wins">· ~{{ expectation.expectedWins }} wins</span>
              </span>
              <span v-if="expectation.blurb" class="exp-blurb">{{ expectation.blurb }}</span>
            </div>
          </main>

          <footer class="modal-footer">
            <button class="btn-confirm" @click="close">
              Let's get to work <ArrowRight :size="16" />
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(4px);
}
.modal-container {
  width: 100%;
  max-width: 520px;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-secondary, #15171c);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  overflow: hidden;
}
.modal-header {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
  background: linear-gradient(135deg, rgba(245, 199, 44, 0.16), rgba(245, 199, 44, 0.03));
}
.hdr-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(245, 199, 44, 0.3), rgba(245, 158, 11, 0.15));
  color: #ffc72c;
  flex-shrink: 0;
}
.modal-title {
  font-size: 1.15rem;
  font-weight: 700;
  margin: 0;
  color: var(--color-text-primary);
}
.modal-sub {
  margin: 2px 0 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}
.modal-content {
  padding: 18px 20px;
  overflow-y: auto;
}
.owner-blurb {
  margin: 0 0 14px;
  font-size: 0.8rem;
  font-style: italic;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}
.chat-log {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chat-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.chat-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(245, 199, 44, 0.16);
  color: #ffc72c;
  margin-top: 2px;
}
.chat-bubble {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: 4px 14px 14px 14px;
  padding: 9px 13px;
  font-size: 0.92rem;
  line-height: 1.45;
  color: var(--color-text-primary);
}
.expectation-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  background: rgba(245, 199, 44, 0.06);
}
.exp-label {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #f5c72c;
}
.exp-value {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary);
}
.exp-wins {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}
.exp-blurb {
  font-size: 0.78rem;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}
.modal-footer {
  padding: 13px 20px;
  border-top: 1px solid var(--glass-border);
  display: flex;
  justify-content: flex-end;
}
.btn-confirm {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 10px 20px;
  border-radius: var(--radius-xl);
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  background: #22c55e;
  color: #08130a;
  border: 1px solid transparent;
  transition: filter 0.15s ease;
}
.btn-confirm:hover {
  filter: brightness(1.08);
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
