<template>
  <button
    v-if="walkthroughKey && !walkthroughStore.isRunning"
    type="button"
    class="wt-replay-btn"
    :class="[`wt-replay-${variant}`, { 'wt-replay-flush': flush }]"
    :title="$t('Replay walkthrough')"
    aria-label="Replay walkthrough"
    @click="replay"
  >?</button>
</template>

<script setup>
import { useWalkthroughStore } from '@/stores/walkthrough'

// Small "?" affordance that replays a page's onboarding walkthrough from the
// beginning. Shown to ALL users (forceStart bypasses both the global enabled
// gate and the per-key done flag), and hidden while any tour is running so
// the overlay never spotlights it.
const props = defineProps({
  // Which tour in walkthroughs/registry.js to replay. Null hides the button
  // (e.g. a tab with no tour) so hosts can pass a computed unconditionally.
  walkthroughKey: { type: String, default: null },
  // 'page' pins fixed to the viewport's bottom-left; 'modal' pins absolute to
  // the nearest positioned ancestor (the player-detail modal content).
  variant: { type: String, default: 'page' },
  // Step to start the replay from — hosts pass a non-zero index when the
  // current page state makes the tour's earlier steps impossible.
  startIndex: { type: Number, default: 0 },
  // Pages without the floating bottom nav (e.g. the roster editor) sit the
  // button at the true bottom-left instead of clearing the 70px nav island.
  flush: { type: Boolean, default: false },
})

const walkthroughStore = useWalkthroughStore()

function replay() {
  walkthroughStore.forceStart(props.walkthroughKey, props.startIndex)
}
</script>

<style scoped>
.wt-replay-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(20, 22, 31, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #8b93a7;
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s ease, background 0.15s ease;
}

.wt-replay-btn:hover,
.wt-replay-btn:active {
  color: #e6e9f0;
  background: rgba(30, 33, 46, 0.85);
}

/* Page variant: floats bottom-left, above the fixed 70px mobile bottom nav.
   z-index 40 keeps it under the walkthrough overlay (90) and toasts (100). */
.wt-replay-page {
  position: fixed;
  left: 12px;
  bottom: calc(70px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + 12px);
  z-index: 40;
}

@media (min-width: 769px) {
  /* Bottom nav is hidden on desktop — drop to the corner. */
  .wt-replay-page {
    bottom: 16px;
  }
}

/* Flush: the host page has no bottom nav at any breakpoint. */
.wt-replay-page.wt-replay-flush {
  bottom: calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + 12px);
}

/* Modal variant: pins to the modal content's bottom-left (the parent provides
   the positioning context). */
.wt-replay-modal {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 5;
}
</style>
