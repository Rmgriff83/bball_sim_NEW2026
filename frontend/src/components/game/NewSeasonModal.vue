<script setup>
import { computed } from 'vue'
import { X, ArrowDown } from 'lucide-vue-next'

const props = defineProps({
  show: { type: Boolean, default: false },
  seasonYear: { type: Number, default: 2025 },
  facilitiesBefore: { type: Object, default: () => ({}) },
  facilitiesAfter: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['close'])

const facilityTypes = ['training', 'medical', 'scouting', 'analytics']

const facilityLabels = {
  training: 'Training',
  medical: 'Medical',
  scouting: 'Scouting',
  analytics: 'Analytics',
}

const degradedFacilities = computed(() => {
  return facilityTypes
    .map(key => ({
      key,
      label: facilityLabels[key],
      before: props.facilitiesBefore[key] ?? 1,
      after: props.facilitiesAfter[key] ?? 1,
    }))
    .filter(f => f.before > f.after)
})

const seasonDisplay = computed(() => {
  return `${props.seasonYear}-${String(props.seasonYear + 1).slice(2)}`
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="emit('close')">
        <div class="modal-container">
          <!-- Header -->
          <header>
            <h2 class="modal-title">New Season</h2>
            <button class="close-btn" @click="emit('close')">
              <X :size="20" />
            </button>
          </header>

          <!-- Content -->
          <main>
            <!-- Season Announcement -->
            <div class="season-announce">
              <span class="season-year">{{ seasonDisplay }}</span>
              <span class="season-label">Season has begun</span>
            </div>

            <!-- Facility Degradation -->
            <section v-if="degradedFacilities.length > 0" class="summary-section">
              <h3 class="section-title">Facility Degradation</h3>
              <p class="section-desc">All team facilities degrade by 1 level at the start of each season.</p>
              <div class="facilities-list">
                <div
                  v-for="facility in degradedFacilities"
                  :key="facility.key"
                  class="facility-item"
                >
                  <span class="facility-name">{{ facility.label }}</span>
                  <div class="facility-change">
                    <span class="level-before">Lv {{ facility.before }}</span>
                    <ArrowDown :size="14" class="arrow-icon" />
                    <span class="level-after">Lv {{ facility.after }}</span>
                  </div>
                </div>
              </div>
            </section>

            <!-- No degradation (all already at level 1) -->
            <section v-else class="summary-section">
              <h3 class="section-title">Facilities</h3>
              <p class="section-desc">All facilities are at base level. Visit the Facilities tab to upgrade.</p>
            </section>
          </main>

          <!-- Footer -->
          <footer>
            <button class="footer-btn action-btn" @click="emit('close')">Let's Go</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Modal transitions */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.25s ease;
}

.modal-enter-active .modal-container,
.modal-leave-active .modal-container {
  transition: transform 0.25s ease, opacity 0.25s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: scale(0.95) translateY(10px);
  opacity: 0;
}

/* Overlay */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

/* Container */
.modal-container {
  background: var(--color-bg-primary, #1a1520);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  width: 100%;
  max-width: 420px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Header */
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.modal-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  background: var(--gradient-cosmic);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.close-btn:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

/* Content */
main {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

/* Season Announcement */
.season-announce {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 24px 16px;
  margin-bottom: 20px;
  background: var(--gradient-cosmic);
  border-radius: var(--radius-lg);
  position: relative;
  overflow: hidden;
}

.season-announce::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1.5px 1.5px at 10% 20%, rgba(255,255,255,0.5), transparent),
    radial-gradient(1px 1px at 50% 60%, rgba(255,255,255,0.3), transparent),
    radial-gradient(1px 1px at 80% 30%, rgba(255,255,255,0.4), transparent);
  pointer-events: none;
}

.season-year {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2.5rem;
  font-weight: 400;
  color: #1a1520;
  letter-spacing: 0.04em;
  line-height: 1;
  position: relative;
  z-index: 1;
}

.season-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: rgba(26, 21, 32, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  position: relative;
  z-index: 1;
}

/* Sections */
.summary-section {
  margin-bottom: 20px;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
  margin-bottom: 8px;
}

.section-desc {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-bottom: 12px;
  line-height: 1.4;
}

/* Facilities List */
.facilities-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.facility-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.02);
}

.facility-item:nth-child(even) {
  background: rgba(255, 255, 255, 0.04);
}

.facility-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.facility-change {
  display: flex;
  align-items: center;
  gap: 6px;
}

.level-before {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
}

.arrow-icon {
  color: var(--color-error, #ef4444);
}

.level-after {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--color-error, #ef4444);
}

/* Footer */
footer {
  display: flex;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.footer-btn {
  flex: 1;
  padding: 12px;
  border-radius: var(--radius-lg);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-btn {
  background: var(--gradient-cosmic);
  border: none;
  color: black;
}

.action-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(232, 90, 79, 0.3);
}
</style>
