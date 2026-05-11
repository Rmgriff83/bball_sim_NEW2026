<script setup>
import { computed, watch } from 'vue'
import { X } from 'lucide-vue-next'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  retirees: {
    type: Array,
    default: () => [],
  },
  season: {
    type: Number,
    default: null,
  },
})

const emit = defineEmits(['close'])

function close() {
  emit('close')
}

function handleKeydown(e) {
  if (e.key === 'Escape') close()
}

watch(() => props.show, (isOpen) => {
  if (isOpen) {
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeydown)
  } else {
    document.body.style.overflow = ''
    window.removeEventListener('keydown', handleKeydown)
  }
})

// Group retirees by their primary team abbreviation; sort groups alphabetically
// by team, and within a group sort by overall rating desc.
const retireesByTeam = computed(() => {
  const groups = new Map()
  for (const r of props.retirees ?? []) {
    const key = r.primaryTeamAbbreviation || 'FA'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (b.overallRating ?? 0) - (a.overallRating ?? 0))
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([team, players]) => ({ team, players }))
})

const totalCount = computed(() => props.retirees?.length ?? 0)

function formatStat(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return Number(value).toFixed(1)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="show"
        class="modal-overlay"
        @click.self="close"
      >
        <div class="modal-container">
          <header class="modal-header">
            <h2 class="modal-title">Retirements{{ season ? ` — ${season} Season` : '' }}</h2>
            <button class="btn-close" @click="close" aria-label="Close">
              <X :size="20" />
            </button>
          </header>

          <main class="modal-content">
            <p class="intro-blurb">
              <template v-if="totalCount === 0">
                No players announced their retirement this offseason.
              </template>
              <template v-else-if="totalCount === 1">
                1 player announced their retirement this offseason.
              </template>
              <template v-else>
                {{ totalCount }} players announced their retirement this offseason.
              </template>
            </p>

            <div v-if="totalCount > 0" class="retirement-groups">
              <div
                v-for="group in retireesByTeam"
                :key="group.team"
                class="retirement-group"
              >
                <h3 class="group-title">{{ group.team }}</h3>
                <ul class="retirement-list">
                  <li
                    v-for="r in group.players"
                    :key="r.id"
                    class="retirement-item"
                  >
                    <PlayerAvatar :player="r" :size="40" />
                    <div class="retiree-info">
                      <div class="retiree-line-1">
                        <span class="retiree-name">{{ r.name }}</span>
                        <span class="retiree-pos">{{ r.position }}</span>
                        <span class="retiree-age">Age {{ r.age }}</span>
                      </div>
                      <div class="retiree-line-2">
                        <span class="retiree-meta">{{ r.careerSeasons || 0 }} season{{ r.careerSeasons === 1 ? '' : 's' }}</span>
                        <span class="retiree-meta-divider">·</span>
                        <span class="retiree-meta">Career-high {{ r.careerHighOvr ?? r.overallRating ?? '—' }} OVR</span>
                        <template v-if="r.lastSeasonStats && (r.lastSeasonStats.ppg || r.lastSeasonStats.rpg || r.lastSeasonStats.apg)">
                          <span class="retiree-meta-divider">·</span>
                          <span class="retiree-meta">
                            {{ formatStat(r.lastSeasonStats.ppg) }} / {{ formatStat(r.lastSeasonStats.rpg) }} / {{ formatStat(r.lastSeasonStats.apg) }}
                          </span>
                        </template>
                      </div>
                    </div>
                    <div class="retiree-ovr">{{ r.overallRating ?? '—' }}</div>
                  </li>
                </ul>
              </div>
            </div>
          </main>

          <footer class="modal-footer">
            <button class="btn-confirm" @click="close">Continue</button>
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
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

.modal-container {
  width: 100%;
  max-width: 540px;
  max-height: 90vh;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
}

.modal-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  letter-spacing: 0.02em;
}

.btn-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  border-radius: var(--radius-full);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.intro-blurb {
  margin: 0 0 16px;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  line-height: 1.4;
}

.retirement-groups {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.retirement-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 4px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--glass-border);
}

.retirement-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.retirement-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.retiree-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.retiree-line-1 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.retiree-name {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.retiree-pos {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.07);
  padding: 1px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.retiree-age {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.retiree-line-2 {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.retiree-meta {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.retiree-meta-divider {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  opacity: 0.5;
}

.retiree-ovr {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  padding: 4px 10px;
  flex-shrink: 0;
}

.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

.btn-confirm {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  border-radius: var(--radius-xl);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: var(--color-primary);
  border: none;
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-confirm:hover {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
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
