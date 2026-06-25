<script setup>
import { computed } from 'vue'
import TeamLogo from '@/components/common/TeamLogo.vue'
import { useDraftStore } from '@/stores/draft'

// Minimal "recent picks" ticker: the 3 picks BEFORE the most recent one (the
// latest pick lives in the Last Pick box). Newest on top; new entries slide in
// from the top and old ones slide out the bottom. Team logos, no headshots.
const draftStore = useDraftStore()

const entries = computed(() => {
  const r = draftStore.draftResults
  if (!r || r.length <= 1) return []
  // The 3 picks before the most recent (the latest lives in the Last Pick box),
  // ordered most-recent first so the newest sits at the TOP of the ticker.
  return r
    .slice(Math.max(0, r.length - 4), r.length - 1)
    .sort((a, b) => (b.pick ?? 0) - (a.pick ?? 0))
})
</script>

<template>
  <div v-if="entries.length > 0" class="news-ticker">
    <TransitionGroup tag="div" name="news" class="nt-list">
      <div v-for="e in entries" :key="e.pick" class="nt-row">
        <TeamLogo :abbreviation="e.teamAbbr" :color="e.teamColor" :size="20" class="nt-logo" />
        <span class="nt-pick">#{{ e.pick }}</span>
        <span class="nt-name">{{ e.playerName }}</span>
        <span class="nt-pos">{{ e.position }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.news-ticker {
  flex-shrink: 0;
  padding: 8px 24px 0px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--glass-border);
}

.nt-list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.nt-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 22px;
  border-bottom: 1px solid var(--glass-border);
  will-change: transform;
  padding-bottom: 2px;
  margin-bottom: 1px;
}

.nt-logo {
  flex-shrink: 0;
}

.nt-pick {
  font-size: 0.66rem;
  font-weight: 800;
  color: var(--color-text-tertiary);
  min-width: 26px;
}

.nt-name {
  min-width: 0;
  opacity: 0.8;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nt-pos {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

/* New entry slides in from the top, old slides out the bottom. */
.news-enter-active,
.news-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.news-enter-from {
  opacity: 0;
  transform: translateY(-14px);
}
.news-leave-to {
  opacity: 0;
  transform: translateY(14px);
}
/* Pull leaving rows out of flow so the remaining rows reflow smoothly. */
.news-leave-active {
  position: absolute;
  left: 0;
  right: 0;
}
.news-move {
  transition: transform 0.35s ease;
}
</style>
