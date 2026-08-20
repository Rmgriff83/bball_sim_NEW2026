<script setup>
// Quick owner chat shown at season rollover when hired staff preserved ≥1
// facility from the usual offseason downgrade (same tap-to-reveal chain UI as
// OwnerCongratsModal). Purely informational: the +2 owner-satisfaction bonus
// was already persisted by the engine (CampaignManager.startNewSeason), so
// closing this modal writes nothing — it just chains to the next modal.
import { ref, computed, watch, nextTick } from 'vue'
import { Crown, Heart, ShieldCheck, ChevronRight, ArrowRight } from 'lucide-vue-next'

const props = defineProps({
  show: { type: Boolean, default: false },
  owner: { type: Object, default: null },
  seasonYear: { type: [Number, String], default: null },
  // [{ key, level, staffName }] from startNewSeason's preservedFacilities
  preservedFacilities: { type: Array, default: () => [] },
})
const emit = defineEmits(['close'])

const ownerName = computed(() =>
  props.owner ? `${props.owner.firstName ?? ''} ${props.owner.lastName ?? ''}`.trim() : 'Team Owner'
)
const ownerFirst = computed(() => props.owner?.firstName ?? 'the owner')

const FACILITY_LABELS = {
  training: 'Training',
  medical: 'Medical',
  scouting: 'Scouting',
  analytics: 'Analytics',
}

// Deterministic variant pick (no Math.random — mirrors OwnerCheckInService).
function _hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

const PRESERVE_VARIANTS = [
  [
    'Walked the halls this week. Usually this time of year the building shows its age — not this summer.',
    'Your staff kept everything running at full strength through the offseason. That is the kind of operation I like paying for.',
    'Consider me impressed. A small bump in my book for the people you hired.',
  ],
  [
    'Got the offseason facilities report on my desk. First time in years it did not make me wince.',
    'The people you put on payroll actually maintained the place instead of letting it slide. Money well spent.',
    'Keep hiring like that and we will both look smart.',
  ],
  [
    'Quick note before the season kicks off — the building crew tells me our facilities held up all summer.',
    'That is your staff doing their jobs. No decay, no repair bills, no headaches for me.',
    'It does not go unnoticed. Carry on.',
  ],
]

const lines = computed(() => {
  const key = `${props.seasonYear ?? ''}${props.owner?.lastName ?? ''}`
  return PRESERVE_VARIANTS[_hash(key) % PRESERVE_VARIANTS.length]
})

const REWARDS = [
  { icon: 'heart', label: 'Owner Satisfaction', chip: '+2' },
]

const queue = computed(() => [
  ...lines.value.map((text) => ({ kind: 'say', text })),
  ...props.preservedFacilities
    .filter((f) => FACILITY_LABELS[f.key])
    .map((f) => ({ kind: 'facility', label: FACILITY_LABELS[f.key], level: f.level })),
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
              <p class="modal-sub">{{ $t('now') }}</p>
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
                  <div class="chat-bubble">{{ $tDynamic(item.text) }}</div>
                </div>

                <!-- Preserved-facility row -->
                <div v-else-if="item.kind === 'facility'" class="facility-row">
                  <span class="facility-icon"><ShieldCheck :size="18" /></span>
                  <span class="facility-label">{{ $tDynamic(item.label) }}</span>
                  <span class="facility-chip">{{ $t('Held at Lv {n}', { n: item.level }) }}</span>
                </div>

                <!-- Reward row -->
                <div v-else class="reward-row">
                  <span class="reward-icon"><Heart :size="18" /></span>
                  <span class="reward-label">{{ $tDynamic(item.reward.label) }}</span>
                  <span class="reward-chip">{{ item.reward.chip }}</span>
                </div>
              </template>
            </TransitionGroup>

            <p v-if="!isComplete" class="tap-hint">{{ $t('Tap to continue…') }}</p>
            <p v-else class="from-hint">— {{ ownerFirst }}</p>
          </main>

          <footer class="modal-footer">
            <button class="btn-confirm" :class="{ done: isComplete }" @click="advance">
              <template v-if="isComplete">{{ $t('Thanks, boss') }} <ArrowRight :size="16" /></template>
              <template v-else>{{ $t('Continue') }} <ChevronRight :size="16" /></template>
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
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.14), rgba(34, 197, 94, 0.03));
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
.facility-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: 36px;
  padding: 9px 12px;
  border: 1px solid rgba(34, 197, 94, 0.35);
  border-radius: 10px;
  background: rgba(34, 197, 94, 0.07);
}
.facility-icon {
  flex-shrink: 0;
  display: inline-flex;
  color: #22c55e;
}
.facility-label {
  flex: 1;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--color-text-primary);
}
.facility-chip {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #22c55e;
  background: rgba(34, 197, 94, 0.14);
  border-radius: 4px;
  padding: 2px 7px;
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
