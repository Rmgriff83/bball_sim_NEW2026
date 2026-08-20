<script setup>
// NEWS DESK — the campaign home's live news reader. Rebuild of the static
// LATEST NEWS card in the style of the live draft's announcer note: each
// recent story "pops out" of a minimal queue list into a reader area where
// the headline types out letter-by-letter (DraftAnnouncer's 22ms/char
// pattern + blinking caret), the body fades in, holds, then the next story
// follows — LOOPING continuously through the window. Controls: pause/play
// (freezes the reading in place) and minimize (collapses to a one-row bar,
// which also pauses).
import { ref, computed, watch, onUnmounted } from 'vue'
import {
  Newspaper, Star, Zap, ChevronDown, ChevronUp, Pause, Play,
} from 'lucide-vue-next'
import { tDynamic, dateLocale } from '@wl-i18n/i18n.js'

const props = defineProps({
  // Newest-first list from campaign.news (CampaignHomeView's `news` computed).
  news: { type: Array, default: () => [] },
  // In-game current date (YYYY-MM-DD) — the queue window is in-game days.
  currentDate: { type: String, default: null },
  campaignId: { type: String, default: null },
})

const emit = defineEmits(['open-all-star'])

const WINDOW_DAYS = 5
const MAX_ITEMS = 8
const TYPE_MS = 32
const HOLD_MS = 5000

// Session memory: remembers a collapsed/paused desk per campaign so
// navigating back to the home page doesn't blare the reader again after the
// user shut it.
const _modeBySession = new Map()

// --- Item normalization (two producer shapes live in campaign.news) ----------
function _itemDate(item) {
  return item?.date ?? item?.gameDate ?? item?.game_date ?? null
}
function _itemType(item) {
  return item?.event_type ?? item?.eventType ?? 'news'
}
function _parseLocal(dateStr) {
  if (!dateStr) return null
  const [y, m, d] = String(dateStr).split('T')[0].split(' ')[0].split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}
function _isAllStarAward(item) {
  // Logic check — matches the stored ENGLISH headline on purpose (old and new
  // records alike), independent of the display language.
  return _itemType(item) === 'award' && item?.headline?.includes('All-Star')
}
// Display strings: translate via the stored template when the record carries
// one; legacy records (headline/body only) fall back to the English string.
function _itemHeadline(item) {
  if (!item) return ''
  return item.headline_tpl ? tDynamic(item.headline_tpl, item.headline_params) : (item.headline ?? '')
}
function _itemBody(item) {
  if (!item) return ''
  return item.body_tpl ? tDynamic(item.body_tpl, item.body_params) : (item.body ?? '')
}

function formatNewsDate(dateStr) {
  const d = _parseLocal(dateStr)
  return d ? d.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' }) : ''
}

// Oldest → newest so the reading ends on the freshest story.
const queue = computed(() => {
  const cur = _parseLocal(props.currentDate) ?? new Date()
  const cutoff = new Date(cur)
  cutoff.setDate(cutoff.getDate() - WINDOW_DAYS)
  const inWindow = (props.news ?? []).filter((item) => {
    const d = _parseLocal(_itemDate(item))
    return d && d >= cutoff && d <= cur
  })
  return inWindow.slice(0, MAX_ITEMS).reverse()
})

const newestId = computed(() => queue.value[queue.value.length - 1]?.id ?? null)

// --- Reader state machine ----------------------------------------------------
// 'reading' loops through the queue forever; 'paused' freezes in place
// (expanded); 'minimized' collapses to the bar (also frozen).
const mode = ref('reading')
const currentIndex = ref(0)
const displayed = ref('')
const showBody = ref(false)
let typeTimer = null
let holdTimer = null

const currentItem = computed(() => queue.value[currentIndex.value] ?? null)
const typing = computed(() =>
  !!currentItem.value && displayed.value.length < _itemHeadline(currentItem.value).length)
const isMinimized = computed(() => mode.value === 'minimized')
const isReading = computed(() => mode.value === 'reading')

// The rest of the loop cycle, in upcoming order — already-read stories rejoin
// the bottom, so the list reads as "what's coming next" forever.
const upcomingItems = computed(() => {
  const q = queue.value
  const i = currentIndex.value
  if (q.length <= 1) return []
  return [...q.slice(i + 1), ...q.slice(0, i)]
})

// Latest headline for the minimized bar.
const newestHeadline = computed(() => _itemHeadline(queue.value[queue.value.length - 1]))

function _clearTimers() {
  clearTimeout(typeTimer)
  clearTimeout(holdTimer)
  typeTimer = null
  holdTimer = null
}

// Type the current headline starting at char index `startIdx` — pause/resume
// continues mid-word instead of re-typing the whole line.
function _typeFrom(startIdx) {
  _clearTimers()
  const text = _itemHeadline(currentItem.value)
  let i = startIdx
  const step = () => {
    displayed.value = text.slice(0, i)
    if (i < text.length) {
      i++
      typeTimer = setTimeout(step, TYPE_MS)
    } else {
      // Headline done — surface the body, hold, then advance.
      showBody.value = true
      holdTimer = setTimeout(_advance, HOLD_MS)
    }
  }
  step()
}

function _readCurrent() {
  displayed.value = ''
  showBody.value = false
  if (!currentItem.value) return
  _typeFrom(0)
}

function _advance() {
  const len = queue.value.length
  if (len <= 1) {
    // Single story: nothing to loop through — rest on it fully displayed.
    _clearTimers()
    showBody.value = true
    return
  }
  currentIndex.value = (currentIndex.value + 1) % len
  _readCurrent()
}

// Resume from wherever the pause landed: mid-headline continues typing,
// post-headline restarts the hold.
function _resume() {
  const item = currentItem.value
  if (!item) return
  const full = _itemHeadline(item)
  if (displayed.value.length < full.length) {
    _typeFrom(displayed.value.length)
  } else {
    showBody.value = true
    holdTimer = setTimeout(_advance, HOLD_MS)
  }
}

function togglePause() {
  if (mode.value === 'reading') {
    _clearTimers()
    mode.value = 'paused'
  } else if (mode.value === 'paused') {
    mode.value = 'reading'
    _resume()
  }
}

function toggleMinimize() {
  if (mode.value === 'minimized') {
    mode.value = 'reading'
    _resume()
  } else {
    _clearTimers()
    mode.value = 'minimized'
  }
}

function handleItemClick(item) {
  if (_isAllStarAward(item)) emit('open-all-star')
}

// Remember a shut/paused desk per campaign for this session.
watch(mode, (m) => {
  if (props.campaignId) _modeBySession.set(props.campaignId, m)
})

// (Re)start the loop when the queue identity changes (mount, new news,
// campaign switch). A desk the user shut stays shut across navigations.
watch([newestId, () => queue.value.length], () => {
  _clearTimers()
  currentIndex.value = 0
  displayed.value = ''
  showBody.value = false
  if (!queue.value.length) {
    if (mode.value !== 'minimized') mode.value = 'paused'
    return
  }
  const remembered = props.campaignId ? _modeBySession.get(props.campaignId) : null
  if (remembered === 'minimized' || remembered === 'paused') {
    mode.value = remembered
    // Show the first story fully-rendered so a paused desk isn't blank.
    displayed.value = _itemHeadline(queue.value[0])
    showBody.value = true
    return
  }
  mode.value = 'reading'
  _readCurrent()
}, { immediate: true })

onUnmounted(_clearTimers)
</script>

<template>
  <section class="news-desk" :class="{ minimized: isMinimized }" data-tour="home-news">
    <!-- Minimized bar (reading is paused while collapsed) -->
    <div v-if="isMinimized" class="nd-minbar">
      <span class="nd-live-dot idle"></span>
      <span class="nd-title">{{ $t('News Desk') }}</span>
      <span class="nd-min-headline">{{ newestHeadline || $t('No news yet') }}</span>
      <button class="nd-ctrl" :title="$t('Expand and resume')" @click="toggleMinimize">
        <ChevronUp :size="16" />
      </button>
    </div>

    <!-- Expanded reader -->
    <template v-else>
      <div class="nd-header">
        <span class="nd-live-dot" :class="{ idle: !isReading }"></span>
        <span class="nd-title">{{ $t('News Desk') }}</span>
        <button
          class="nd-ctrl"
          :title="isReading ? $t('Pause the reading') : $t('Resume the reading')"
          @click="togglePause"
        >
          <Pause v-if="isReading" :size="15" />
          <Play v-else :size="15" />
        </button>
        <button class="nd-ctrl" :title="$t('Minimize')" @click="toggleMinimize">
          <ChevronDown :size="16" />
        </button>
      </div>

      <!-- Empty state -->
      <div v-if="!queue.length" class="nd-empty">
        <p>{{ $t('No news yet. Simulate some games to generate headlines!') }}</p>
      </div>

      <template v-else>
        <!-- Live reader: the story currently being read -->
        <div
          v-if="currentItem"
          class="nd-reader"
          :class="{ 'nd-clickable': _isAllStarAward(currentItem) }"
          @click="handleItemClick(currentItem)"
        >
          <div
            class="nd-reader-icon"
            :class="{ star: _itemType(currentItem) === 'award', breaking: currentItem.is_breaking }"
          >
            <Zap v-if="currentItem.is_breaking" :size="18" />
            <Star v-else-if="_itemType(currentItem) === 'award'" :size="18" />
            <Newspaper v-else :size="18" />
          </div>
          <div class="nd-reader-text">
            <span v-if="currentItem.is_breaking" class="nd-breaking-tag">{{ $t('Breaking') }}</span>
            <p class="nd-reader-headline">
              {{ displayed }}<span v-if="typing" class="nd-caret">▍</span>
            </p>
            <Transition name="nd-body">
              <p v-if="showBody && currentItem.body" class="nd-reader-body">{{ _itemBody(currentItem) }}</p>
            </Transition>
            <span class="nd-reader-date">{{ formatNewsDate(_itemDate(currentItem)) }}</span>
          </div>
        </div>

        <!-- Upcoming loop queue (top row pops out into the reader; read
             stories rejoin the bottom) -->
        <TransitionGroup
          v-if="upcomingItems.length"
          tag="div"
          name="nd-queue"
          class="nd-queue"
        >
          <div
            v-for="item in upcomingItems"
            :key="item.id"
            class="nd-queue-row"
            :class="{ 'nd-clickable': _isAllStarAward(item) }"
            @click="handleItemClick(item)"
          >
            <span class="nd-queue-icon" :class="{ breaking: item.is_breaking }">
              <Zap v-if="item.is_breaking" :size="12" />
              <Star v-else-if="_itemType(item) === 'award'" :size="12" />
              <Newspaper v-else :size="12" />
            </span>
            <span class="nd-queue-headline">{{ _itemHeadline(item) }}</span>
            <span class="nd-queue-date">{{ formatNewsDate(_itemDate(item)) }}</span>
          </div>
        </TransitionGroup>
      </template>
    </template>
  </section>
</template>

<style scoped>
.news-desk {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 16px;
  margin-bottom: 16px;
  transition: padding 0.25s ease;
}

.news-desk.minimized {
  padding: 8px 12px;
}

/* Header / minimized bar */
.nd-header,
.nd-minbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nd-header {
  margin-bottom: 12px;
}

.nd-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.05rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-primary);
  flex-shrink: 0;
}

.nd-live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
  animation: nd-pulse 1.6s ease-in-out infinite;
  flex-shrink: 0;
}

.nd-live-dot.idle {
  background: var(--color-text-tertiary);
  animation: none;
}

@keyframes nd-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
  50% { opacity: 0.75; box-shadow: 0 0 0 5px rgba(239, 68, 68, 0); }
}

.nd-header .nd-title { margin-right: auto; }

.nd-min-headline {
  flex: 1;
  min-width: 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nd-ctrl {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.nd-ctrl:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

/* Reader */
.nd-reader {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  min-height: 84px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-lg);
  border-left: 3px solid var(--color-primary);
}

.nd-reader-icon {
  width: 32px;
  height: 32px;
  background: var(--color-primary);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: white;
}

.nd-reader-icon.star { background: linear-gradient(135deg, #f59e0b, #d97706); }
.nd-reader-icon.breaking { background: linear-gradient(135deg, #eab308, #ca8a04); }

.nd-reader-text {
  flex: 1;
  min-width: 0;
}

.nd-breaking-tag {
  display: inline-block;
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #eab308;
  background: rgba(234, 179, 8, 0.15);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  margin-bottom: 2px;
}

.nd-reader-headline {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 4px;
  line-height: 1.4;
  min-height: 1.3em;
}

.nd-caret {
  color: var(--color-primary);
  animation: nd-blink 0.9s step-end infinite;
}

@keyframes nd-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.nd-reader-body {
  font-size: 0.8rem;
  font-style: italic;
  color: var(--color-text-secondary);
  line-height: 1.45;
  margin: 0 0 4px;
}

.nd-body-enter-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.nd-body-enter-from { opacity: 0; transform: translateY(4px); }

.nd-reader-date {
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
}

/* Minimal queue list */
.nd-queue {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.nd-queue-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
}

.nd-queue-icon {
  display: inline-flex;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.nd-queue-icon.breaking { color: #eab308; }

.nd-queue-headline {
  flex: 1;
  min-width: 0;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nd-queue-date {
  font-size: 0.68rem;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.nd-clickable { cursor: pointer; }
.nd-clickable:hover { background: var(--color-bg-elevated); }

/* Queue transitions — the TOP row pops upward out of the list (toward the
   reader) while the rest reflow; DraftNewsTicker's pattern. */
.nd-queue-enter-active,
.nd-queue-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.nd-queue-enter-from { opacity: 0; transform: translateY(10px); }
.nd-queue-leave-to { opacity: 0; transform: translateY(-14px) scale(0.98); }
.nd-queue-leave-active {
  position: absolute;
  left: 0;
  right: 0;
}
.nd-queue-move { transition: transform 0.35s ease; }

.nd-empty {
  padding: 24px 16px;
  text-align: center;
}
.nd-empty p {
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
  margin: 0;
}
</style>
