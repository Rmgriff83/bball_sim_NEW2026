<script setup>
// Impromptu owner text when the owner RAISES their expectation tier
// mid-season or at season end (hot start / strong year) — a short
// congratulatory chat (same tap-to-reveal chain UI as OwnerCongratsModal)
// ending in the new-mandate row and a +10 owner-satisfaction reward row.
// The PARENT applies the +10 exactly once when this closes.
import { ref, computed, watch, nextTick } from 'vue'
import { TrendingUp, Heart, ChevronRight, ArrowRight } from 'lucide-vue-next'
import { EXPECTATION_LABEL } from '@/engine/data/owners'

const props = defineProps({
  show: { type: Boolean, default: false },
  owner: { type: Object, default: null },
  seasonYear: { type: [Number, String], default: null },
  teamName: { type: String, default: '' },
  // The tier moved TO and FROM ('develop'|'playoffs'|'contender'|'championship').
  tier: { type: String, default: null },
  fromTier: { type: String, default: null },
  // The new win bar (stored ownerExpectation.expectedWins) — chip hidden when null.
  expectedWins: { type: Number, default: null },
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

// Copy keyed by the tier the owner moved UP to (raises never target
// 'rebuild'); 'generic' is the fallback for anything unmapped.
const RAISE_VARIANTS = {
  develop: [
    [
      'I like what I\'m seeing out there — this group is ahead of schedule.',
      'Keep developing these guys the way you have been and we\'ll be dangerous sooner than anyone thinks.',
      'I\'m raising my expectations for this season. Show me real progress.',
    ],
    [
      'The young core is growing faster than I expected. That\'s on you.',
      'I told everyone this was a long rebuild — you\'re making me look impatient, in a good way.',
      'The bar just went up. I think this team can climb the standings this year.',
    ],
  ],
  playoffs: [
    [
      'You\'ve got this team playing real basketball. The city is noticing.',
      'I didn\'t expect us to look this good this early — credit where it\'s due.',
      'I want postseason basketball in this building. I think you can deliver it.',
    ],
    [
      'Look at this record. You\'re building something real here.',
      'I\'m done talking about development — this team is ready to compete now.',
      'New expectation: make the playoffs. You\'ve earned the higher bar.',
    ],
  ],
  contender: [
    [
      'This team is better than even I hoped. You\'ve done outstanding work.',
      'We\'re not just a playoff team anymore — we can go toe to toe with anyone.',
      'I expect a deep run now. Push this group like a contender, because that\'s what they are.',
    ],
    [
      'Every night I watch this team, I see a group that can beat anybody.',
      'You assembled this. Own it — we\'re contenders now.',
      'The bar moves up tonight: a deep playoff run. I believe you\'ll clear it.',
    ],
  ],
  championship: [
    [
      'You\'ve been outstanding — this roster looks like a championship team.',
      'I\'ve owned this team a long time, and I\'ve never felt a season like this one brewing.',
      'So here it is: I want the banner. Bring it home.',
    ],
    [
      'What you\'ve built here is special. Everyone in the league knows it.',
      'Teams like this don\'t come around often. We can\'t waste it.',
      'My expectation is a championship now. No pressure — just history.',
    ],
  ],
  generic: [
    [
      'You\'ve exceeded every expectation I set for you this season.',
      'When a team outperforms its owner\'s imagination, the owner adjusts.',
      'I\'m raising the bar. Keep this going.',
    ],
  ],
}

const lines = computed(() => {
  const pool = RAISE_VARIANTS[props.tier] ?? RAISE_VARIANTS.generic
  const key = `${props.seasonYear ?? ''}${props.owner?.lastName ?? ''}${props.tier ?? ''}`
  return pool[_hash(key) % pool.length]
})

const REWARDS = [
  { icon: 'heart', label: 'Owner Satisfaction', chip: '+10' },
]

const queue = computed(() => [
  ...lines.value.map((text) => ({ kind: 'say', text })),
  { kind: 'expectation' },
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
            <div class="hdr-avatar"><TrendingUp :size="22" /></div>
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
                  <div class="chat-avatar"><TrendingUp :size="14" /></div>
                  <div class="chat-bubble">{{ $tDynamic(item.text) }}</div>
                </div>

                <!-- New-mandate row: old tier → new tier (+ win bar) -->
                <div v-else-if="item.kind === 'expectation'" class="reward-row expectation-row">
                  <span class="reward-icon"><TrendingUp :size="18" /></span>
                  <span class="reward-label">
                    <template v-if="fromTier">{{ $tDynamic(EXPECTATION_LABEL[fromTier] ?? fromTier) }} <ArrowRight :size="12" class="expectation-arrow" /> </template>{{ $tDynamic(EXPECTATION_LABEL[tier] ?? tier ?? '') }}
                  </span>
                  <span v-if="expectedWins != null" class="reward-chip">{{ $t('{n}+ wins', { n: expectedWins }) }}</span>
                </div>

                <!-- Reward row -->
                <div v-else class="reward-row">
                  <span class="reward-icon"><Heart :size="18" /></span>
                  <span class="reward-label">{{ $tDynamic(item.reward.label) }}</span>
                  <span class="reward-chip">{{ $tDynamic(item.reward.chip) }}</span>
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
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.28), rgba(34, 197, 94, 0.12));
  color: #22c55e;
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
  background: rgba(34, 197, 94, 0.16);
  color: #22c55e;
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
  border: 1px solid rgba(34, 197, 94, 0.35);
  border-radius: 10px;
  background: rgba(34, 197, 94, 0.07);
}
.reward-icon {
  flex-shrink: 0;
  display: inline-flex;
  color: #22c55e;
}
.reward-label {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--color-text-primary);
}
.expectation-arrow {
  color: var(--color-text-secondary);
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
