<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { Mic } from 'lucide-vue-next'
import { useDraftStore } from '@/stores/draft'
import { pickAnalysis } from '@/engine/draft/draftCommentary'

// Rookie-only "announcer" line: the pick commentary for the most recent pick,
// revealed letter-by-letter like a news story breaking in. Hidden for fantasy
// drafts (commentary is empty).
const props = defineProps({
  // Calendar year of the draft class (e.g. 2026) for the closing line.
  draftYear: { type: [Number, String], default: null },
})

const draftStore = useDraftStore()

const pick = computed(() => draftStore.lastPickResult)

const commentary = computed(() => {
  if (draftStore.draftMode !== 'rookie') return ''
  // Draft over → sign-off line.
  if (draftStore.isDraftComplete) {
    return `And that concludes the ${props.draftYear || ''} Draft. Thanks for joining us!`.replace(/\s+/g, ' ').trim()
  }
  // Draft hasn't started yet → welcome line.
  if (!pick.value) {
    return `Welcome to the ${props.draftYear || ''} Draft! The future starts here — let's get the first pick in.`.replace(/\s+/g, ' ').trim()
  }
  return pickAnalysis({
    teamName: pick.value.teamName,
    teamAbbr: pick.value.teamAbbr,
    direction: draftStore.teamDirections?.[pick.value.teamId],
    player: pick.value,
    round: pick.value.round,
    pick: pick.value.pick,
  })
})

// Typewriter reveal.
const displayed = ref('')
const typing = computed(() => displayed.value.length < commentary.value.length)
let timer = null

function typeOut(text) {
  clearTimeout(timer)
  displayed.value = ''
  let i = 0
  const step = () => {
    displayed.value = text.slice(0, i)
    if (i < text.length) {
      i++
      timer = setTimeout(step, 22)
    }
  }
  step()
}

watch(commentary, (text) => {
  if (text) {
    typeOut(text)
  } else {
    clearTimeout(timer)
    displayed.value = ''
  }
}, { immediate: true })

onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <div v-if="commentary" class="announcer">
    <Mic :size="15" class="announcer-icon" />
    <span class="announcer-text">“{{ displayed }}”<span v-if="typing" class="announcer-caret">▍</span></span>
  </div>
</template>

<style scoped>
.announcer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--glass-border);
}

.announcer-icon {
  flex-shrink: 0;
  color: var(--color-primary);
}

.announcer-text {
  min-width: 0;
  font-size: 0.78rem;
  font-style: italic;
  font-weight: 500;
  line-height: 1.3;
  color: var(--color-text-secondary);
}

.announcer-caret {
  font-style: normal;
  font-weight: 400;
  color: var(--color-primary);
  animation: announcer-blink 0.9s step-end infinite;
}

@keyframes announcer-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

@media (max-width: 768px) {
  .announcer {
    padding: 8px 16px;
  }
}
</style>
