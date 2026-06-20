<script setup>
// The owner's start-of-season check-in. A conversation revealed piece by piece:
// the user taps "Continue" (or the log) to advance, the owner's lines and the
// current sub-goals build up into a chat log, and the final tap ("Let's get to
// work") dismisses it. Shown as the very first thing each season — non-dismissable
// except via the final button — and the onboarding tours wait until it closes.
import { ref, computed, watch, nextTick } from 'vue'
import { Crown, CheckCircle2, Circle, ChevronRight, ArrowRight } from 'lucide-vue-next'

const props = defineProps({
  show: { type: Boolean, default: false },
  owner: { type: Object, default: null },
  checkIn: { type: Object, default: null },
  seasonYear: { type: [Number, String], default: null },
})
const emit = defineEmits(['close'])

const ownerName = computed(() =>
  props.owner ? `${props.owner.firstName ?? ''} ${props.owner.lastName ?? ''}`.trim() : 'Team Owner'
)

// Flatten the dialogue into an ordered reveal queue.
const queue = computed(() => {
  const c = props.checkIn
  if (!c) return []
  const items = []
  for (const line of c.greetingLines || []) items.push({ kind: 'say', text: line })
  if (c.subtaskIntro) items.push({ kind: 'say', text: c.subtaskIntro })
  for (const t of c.subtasks || []) items.push({ kind: 'task', task: t })
  for (const line of c.closingLines || []) items.push({ kind: 'say', text: line })
  return items
})

const revealedCount = ref(0)
const revealed = computed(() => queue.value.slice(0, revealedCount.value))
const isComplete = computed(() => revealedCount.value >= queue.value.length && queue.value.length > 0)

const logEl = ref(null)
function scrollToEnd() {
  nextTick(() => {
    const el = logEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function advance() {
  if (isComplete.value) {
    emit('close')
    return
  }
  revealedCount.value = Math.min(queue.value.length, revealedCount.value + 1)
  scrollToEnd()
}

watch(
  () => props.show,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      revealedCount.value = Math.min(1, queue.value.length)
      scrollToEnd()
    }
  },
  { immediate: true }
)
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show && checkIn" class="modal-overlay">
        <div class="modal-container">
          <header class="modal-header">
            <div class="hdr-avatar"><Crown :size="22" /></div>
            <div>
              <h2 class="modal-title">Owner Check-In</h2>
              <p class="modal-sub">
                {{ ownerName }}<span v-if="seasonYear"> · {{ seasonYear }} Season</span>
              </p>
            </div>
          </header>

          <main
            ref="logEl"
            class="modal-content"
            :class="{ tappable: !isComplete }"
            @click="!isComplete && advance()"
          >
            <TransitionGroup name="reveal" tag="div" class="chat-log">
              <template v-for="(item, i) in revealed" :key="i">
                <!-- Owner line -->
                <div v-if="item.kind === 'say'" class="chat-row">
                  <div class="chat-avatar"><Crown :size="14" /></div>
                  <div class="chat-bubble">{{ item.text }}</div>
                </div>

                <!-- Sub-goal note -->
                <div v-else class="task-row" :class="{ met: item.task.met }">
                  <span class="task-icon">
                    <CheckCircle2 v-if="item.task.met" :size="18" />
                    <Circle v-else :size="18" />
                  </span>
                  <span class="task-text">
                    <span class="task-label">
                      {{ item.task.label }}
                      <span v-if="item.task.global" class="task-tag">Global</span>
                      <span class="task-status" :class="{ done: item.task.met }">
                        <template v-if="item.task.progress">{{ item.task.progress.current }}/{{ item.task.progress.target }}</template>
                        <template v-else>{{ item.task.met ? 'Done' : 'Not yet' }}</template>
                      </span>
                    </span>
                    <span v-if="item.task.description" class="task-desc">{{ item.task.description }}</span>
                  </span>
                </div>
              </template>
            </TransitionGroup>

            <p v-if="!isComplete" class="tap-hint">Tap to continue…</p>
          </main>

          <footer class="modal-footer">
            <button class="btn-confirm" :class="{ done: isComplete }" @click="advance">
              <template v-if="isComplete">Let's get to work <ArrowRight :size="16" /></template>
              <template v-else>Continue <ChevronRight :size="16" /></template>
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
  max-width: 560px;
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
.modal-content.tappable {
  cursor: pointer;
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
.task-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-left: 36px;
  padding: 7px 11px;
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}
.task-icon {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--color-text-tertiary);
  display: inline-flex;
}
.task-row.met .task-icon {
  color: #22c55e;
}
.task-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.task-label {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}
.task-row.met .task-label {
  color: var(--color-text-primary);
}
.task-tag {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #f5c72c;
  background: rgba(245, 199, 44, 0.14);
  border-radius: 4px;
  padding: 1px 5px;
}
.task-status {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #f97316;
  background: rgba(249, 115, 22, 0.14);
  border-radius: 4px;
  padding: 1px 6px;
}
.task-status.done {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.14);
}
.task-desc {
  font-size: 0.74rem;
  color: var(--color-text-tertiary);
  line-height: 1.35;
}
.tap-hint {
  margin: 14px 0 2px;
  text-align: center;
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
  opacity: 0.7;
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
  border: none;
  cursor: pointer;
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  transition: background 0.15s ease;
}
.btn-confirm.done {
  background: #22c55e;
  color: #08130a;
  border-color: transparent;
}

/* Reveal + modal transitions */
.reveal-enter-active {
  transition: opacity 0.28s ease, transform 0.28s ease;
}
.reveal-enter-from {
  opacity: 0;
  transform: translateY(8px);
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
