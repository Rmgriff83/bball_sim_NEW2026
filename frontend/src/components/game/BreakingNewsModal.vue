<script setup>
import { computed, watch, onMounted, onUnmounted } from 'vue'
import { X, Repeat, Clock, Star, Trophy } from 'lucide-vue-next'

const props = defineProps({
  show: { type: Boolean, default: false },
  item: { type: Object, default: null },
})
const emit = defineEmits(['dismiss'])

const iconMap = { Repeat, Clock, Star, Trophy }

const isChampion = computed(() => props.item?.category === 'CHAMPION')

function getIcon(name) {
  return iconMap[name] || Trophy
}

function getCategoryColor(category) {
  switch (category) {
    case 'TRADE': return '#3b82f6'
    case 'DEADLINE': return '#f59e0b'
    case 'ALL-STAR': return '#eab308'
    case 'PLAYOFFS': return '#8b5cf6'
    case 'CHAMPION': return '#ffd700'
    default: return '#3b82f6'
  }
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function onKeydown(e) {
  if (e.key === 'Escape' && props.show) {
    emit('dismiss')
  }
}

watch(() => props.show, (val) => {
  document.body.style.overflow = val ? 'hidden' : ''
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="bn-modal">
      <div v-if="show && item" class="bn-overlay" @click.self="emit('dismiss')">
        <div class="bn-container" :class="{ 'is-champion': isChampion }">
          <!-- Breaking News Banner -->
          <div class="bn-banner" :class="{ 'bn-banner-champion': isChampion }">
            <Trophy v-if="isChampion" :size="20" class="bn-banner-trophy" />
            <span class="bn-banner-text">{{ isChampion ? 'NBA CHAMPIONS' : 'BREAKING NEWS' }}</span>
            <Trophy v-if="isChampion" :size="20" class="bn-banner-trophy" />
            <div class="bn-banner-shimmer"></div>
          </div>

          <!-- Article Panel -->
          <div class="bn-article">
            <div class="bn-article-top">
              <span
                class="bn-category"
                :style="{ background: getCategoryColor(item.category), color: '#fff' }"
              >
                <component :is="getIcon(item.icon)" :size="12" />
                {{ item.category }}
              </span>
              <button class="bn-close" @click="emit('dismiss')" aria-label="Close">
                <X :size="20" />
              </button>
            </div>

            <div class="bn-article-body">
              <h2 class="bn-headline">{{ item.headline }}</h2>
              <div class="bn-rule"></div>
              <div class="bn-dateline">
                <span>{{ formatDate(item.date) }}</span>
                <span class="bn-wire">League Wire</span>
              </div>
              <p class="bn-body">{{ item.body }}</p>
            </div>
          </div>

          <!-- Footer -->
          <div class="bn-footer">
            <button class="bn-btn-continue" @click="emit('dismiss')">CONTINUE</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bn-overlay {
  position: fixed;
  inset: 0;
  z-index: 55;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  /* Newspaper-textured background */
  background:
    radial-gradient(ellipse at 30% 20%, rgba(210, 190, 160, 0.95), transparent 70%),
    radial-gradient(ellipse at 70% 80%, rgba(200, 180, 150, 0.9), transparent 60%),
    linear-gradient(180deg, #d4c5a9, #c4b494, #b8a888);
  /* Noise texture via repeating SVG */
  background-blend-mode: multiply;
}

.bn-overlay::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.08'/%3E%3C/svg%3E");
  background-size: 200px 200px;
  pointer-events: none;
  opacity: 0.5;
}

.bn-container {
  position: relative;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-2xl);
  overflow: hidden;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
}

/* Banner */
.bn-banner {
  position: relative;
  overflow: hidden;
  padding: 14px 20px;
  background: linear-gradient(135deg, #dc2626, #b91c1c, #f59e0b);
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.bn-banner-text {
  position: relative;
  z-index: 1;
  font-family: var(--font-display);
  font-size: 1.6rem;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.15em;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

/* Champion Banner */
.bn-banner-champion {
  background: linear-gradient(135deg, #b8860b, #daa520, #ffd700, #daa520, #b8860b);
  padding: 18px 20px;
}

.bn-banner-champion .bn-banner-text {
  font-size: 1.8rem;
  letter-spacing: 0.2em;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}

.bn-banner-trophy {
  position: relative;
  z-index: 1;
  color: #fff;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
}

.bn-container.is-champion {
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5), 0 0 40px rgba(255, 215, 0, 0.15);
}

.bn-banner-shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.15) 45%,
    rgba(255, 255, 255, 0.25) 50%,
    rgba(255, 255, 255, 0.15) 55%,
    transparent 100%
  );
  animation: bn-shimmer 3s ease-in-out infinite;
}

@keyframes bn-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

/* Article */
.bn-article {
  background: var(--color-bg-secondary);
  border-left: 1px solid var(--glass-border);
  border-right: 1px solid var(--glass-border);
  flex: 1;
  overflow-y: auto;
}

.bn-article-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 0;
}

.bn-category {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: var(--radius-lg);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.bn-close {
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-md);
  transition: color 0.2s;
}

.bn-close:hover {
  color: var(--color-text-primary);
}

.bn-article-body {
  padding: 20px;
}

.bn-headline {
  font-family: var(--font-display);
  font-size: 1.8rem;
  font-weight: 700;
  line-height: 1.15;
  color: var(--color-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin: 0 0 16px;
}

.bn-rule {
  height: 2px;
  background: linear-gradient(90deg, var(--color-text-primary), transparent);
  margin-bottom: 12px;
  opacity: 0.2;
}

.bn-dateline {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 16px;
}

.bn-wire {
  font-weight: 600;
  color: var(--color-text-secondary);
}

.bn-body {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 0.95rem;
  line-height: 1.7;
  color: var(--color-text-secondary);
  margin: 0;
}

/* Footer */
.bn-footer {
  padding: 16px 20px;
  background: var(--color-bg-secondary);
  border-top: 1px solid var(--glass-border);
  border-left: 1px solid var(--glass-border);
  border-right: 1px solid var(--glass-border);
  border-radius: 0 0 var(--radius-2xl) var(--radius-2xl);
}

.bn-btn-continue {
  width: 100%;
  padding: 12px 20px;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-xl);
  color: white;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.bn-btn-continue:hover {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

/* Transitions */
.bn-modal-enter-active {
  transition: opacity 0.3s ease;
}

.bn-modal-enter-active .bn-container {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

.bn-modal-leave-active {
  transition: opacity 0.25s ease;
}

.bn-modal-leave-active .bn-container {
  transition: transform 0.25s ease, opacity 0.25s ease;
}

.bn-modal-enter-from {
  opacity: 0;
}

.bn-modal-enter-from .bn-container {
  transform: scale(0.96);
  opacity: 0;
}

.bn-modal-leave-to {
  opacity: 0;
}

.bn-modal-leave-to .bn-container {
  transform: scale(0.96);
  opacity: 0;
}

/* Light theme adjustments */
[data-theme="light"] .bn-overlay {
  background:
    radial-gradient(ellipse at 30% 20%, rgba(230, 215, 190, 0.98), transparent 70%),
    radial-gradient(ellipse at 70% 80%, rgba(220, 205, 180, 0.95), transparent 60%),
    linear-gradient(180deg, #e8dcc8, #ddd0b8, #d4c5a9);
}
</style>
