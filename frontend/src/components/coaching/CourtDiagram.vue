<script setup>
// Stylized SVG half-court used as the shared backdrop for play-animation
// previews and defensive-scheme diagrams. ViewBox is 0..100 in both axes,
// matching the normalized 0-1 play coordinate convention scaled ×100
// (x=0 left → 100 right, y=0 perimeter → 100 baseline; hoop bottom-center).
// Children passed via the default slot draw in the same coordinate space.
</script>

<template>
  <svg
    class="court-diagram"
    viewBox="0 0 100 100"
    preserveAspectRatio="xMidYMid meet"
  >
    <!-- Hardwood -->
    <rect x="0" y="0" width="100" height="100" rx="3" class="court-floor" />

    <!-- Baseline -->
    <line x1="2" y1="96" x2="98" y2="96" class="court-line" />

    <!-- Paint / key -->
    <rect x="34" y="45" width="32" height="51" class="court-line court-fill-paint" />
    <!-- Free-throw circle -->
    <circle cx="50" cy="45" r="9" class="court-line" />

    <!-- 3-point line: corner segments + arc -->
    <line x1="7" y1="96" x2="7" y2="70" class="court-line" />
    <line x1="93" y1="96" x2="93" y2="70" class="court-line" />
    <path d="M 7 70 C 7 18 93 18 93 70" class="court-line" fill="none" />

    <!-- Backboard + rim -->
    <line x1="42" y1="91" x2="58" y2="91" class="court-line court-backboard" />
    <circle cx="50" cy="88" r="2.2" class="court-rim" />

    <slot />
  </svg>
</template>

<style scoped>
.court-diagram {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 10px;
  background: linear-gradient(160deg, #c8854b, #b3713a);
}

.court-floor {
  fill: transparent;
}

.court-line {
  stroke: rgba(255, 255, 255, 0.78);
  stroke-width: 0.8;
  fill: none;
}

.court-fill-paint {
  fill: rgba(255, 255, 255, 0.06);
}

.court-backboard {
  stroke: rgba(255, 255, 255, 0.9);
  stroke-width: 1.4;
}

.court-rim {
  stroke: #ff5a2c;
  stroke-width: 1.2;
  fill: none;
}

[data-theme='light'] .court-diagram {
  background: linear-gradient(160deg, #d9925a, #c47d44);
}
</style>
