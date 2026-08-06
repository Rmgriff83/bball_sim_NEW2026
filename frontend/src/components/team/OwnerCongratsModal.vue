<script setup>
// Impromptu owner text after the user wins the championship — a short
// congratulatory chat (same tap-to-reveal chain UI as OwnerCheckInModal)
// ending in two reward rows: +1,000 bonus tokens and +15 owner satisfaction.
// Shown after the championship recap closes, before entering the offseason.
// The PARENT applies the actual rewards exactly once when this closes.
import { ref, computed, watch, nextTick } from 'vue'
import { Crown, Coins, Heart, ChevronRight, ArrowRight } from 'lucide-vue-next'

const props = defineProps({
  show: { type: Boolean, default: false },
  owner: { type: Object, default: null },
  seasonYear: { type: [Number, String], default: null },
  teamName: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const ownerName = computed(() =>
  props.owner ? `${props.owner.firstName ?? ''} ${props.owner.lastName ?? ''}`.trim() : 'Team Owner'
)
const ownerFirst = computed(() => props.owner?.firstName ?? 'the owner')

// Deterministic variant pick (no Math.random — mirrors OwnerCheckInService).
function _hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

const CONGRATS_VARIANTS = [
  [
    'CHAMPIONS!!! I\'m still shaking. What a series. What a season.',
    'Everything we asked of you, you delivered — and then you went and hung a banner on top of it.',
    'I\'ve wired something extra to your account. You\'ve earned every bit of it. Enjoy tonight.',
  ],
  [
    'WE DID IT! The whole building is going crazy right now.',
    'When I hired you I said I wanted a winner. You gave me a champion.',
    'Check your account — a little championship bonus from me, personally. Celebrate properly.',
  ],
  [
    'A title. An actual title. I\'ve dreamed about this since I bought this team.',
    'You built this roster, you made the calls, and tonight it paid off in front of the whole league.',
    'I\'m sending a bonus your way — the least I can do. Soak this one in.',
  ],
]

const lines = computed(() => {
  const key = `${props.seasonYear ?? ''}${props.owner?.lastName ?? ''}`
  return CONGRATS_VARIANTS[_hash(key) % CONGRATS_VARIANTS.length]
})

const REWARDS = [
  { icon: 'coins', label: 'Championship Bonus', chip: '+1,000 tokens' },
  { icon: 'heart', label: 'Owner Satisfaction', chip: '+15' },
]

const queue = computed(() => [
  ...lines.value.map((text) => ({ kind: 'say', text })),
  ...REWARDS.map((reward) => ({ kind: 'reward', reward })),
])

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
      <div v-if="show" class="modal-overlay">
        <div class="modal-container">
          <header class="modal-header">
            <div class="hdr-avatar"><Crown :size="22" /></div>
            <div>
              <h2 class="modal-title">{{ ownerName }}</h2>
              <p class="modal-sub">now</p>
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

                <!-- Reward row -->
                <div v-else class="reward-row">
                  <span class="reward-icon">
                    <Coins v-if="item.reward.icon === 'coins'" :size="18" />
                    <Heart v-else :size="18" />
                  </span>
                  <span class="reward-label">{{ item.reward.label }}</span>
                  <span class="reward-chip">{{ item.reward.chip }}</span>
                </div>
              </template>
            </TransitionGroup>

            <p v-if="!isComplete" class="tap-hint">Tap to continue…</p>
            <p v-else class="from-hint">— {{ ownerFirst }}</p>
          </main>

          <footer class="modal-footer">
            <button class="btn-confirm" :class="{ done: isComplete }" @click="advance">
              <template v-if="isComplete">Thanks, boss <ArrowRight :size="16" /></template>
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
  max-width: 480px;
  max-height: 82vh;
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
.reward-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: 36px;
  padding: 9px 12px;
  border: 1px solid rgba(245, 199, 44, 0.35);
  border-radius: 10px;
  background: rgba(245, 199, 44, 0.07);
}
.reward-icon {
  flex-shrink: 0;
  display: inline-flex;
  color: #ffc72c;
}
.reward-label {
  flex: 1;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--color-text-primary);
}
.reward-chip {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #22c55e;
  background: rgba(34, 197, 94, 0.14);
  border-radius: 4px;
  padding: 2px 7px;
}
.tap-hint {
  margin: 14px 0 2px;
  text-align: center;
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
  opacity: 0.7;
}
.from-hint {
  margin: 14px 0 2px;
  text-align: right;
  font-size: 0.78rem;
  font-style: italic;
  color: var(--color-text-tertiary);
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
