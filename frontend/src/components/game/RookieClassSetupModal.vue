<script setup>
// Season-start rookie-class setup (custom_roster owners only). Shown right
// after the Owner Check-In: keep the generated class, open the class editor,
// or replace it with an imported community draft class. Dismissing (X /
// overlay) counts as "Generate & Continue" — the class already exists, so
// closing IS accepting it; the parent stamps resolution either way.
import { ref, computed, watch } from 'vue'
import { X, Sparkles, PencilRuler, Download, Loader2 } from 'lucide-vue-next'
import api from '@/composables/useApi'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { listDraftClassWorkshopSources } from '@/engine/campaign/WorkshopService'

const props = defineProps({
  show: { type: Boolean, default: false },
  campaignId: { type: String, default: null },
  seasonYear: { type: Number, default: null },
  draftYear: { type: Number, default: null },
  // Parent flips while an imported class is downloading/applying.
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['continue', 'edit', 'apply-imported', 'open-community'])

const classCount = ref(null)
const downloadedClasses = ref([])
const builderClasses = ref([])
const selectedBuildId = ref(null)

// Builder projects first — the user's own work-in-progress classes are the
// most likely pick and need no publish to appear here.
const importedClasses = computed(() => [
  ...builderClasses.value.map((w) => ({
    id: `workshop:${w.workshopId}`,
    _workshopId: w.workshopId,
    title: w.title,
    prospectCount: w.prospectCount,
  })),
  ...downloadedClasses.value,
])

const seasonDisplay = computed(() =>
  props.seasonYear != null ? `${props.seasonYear}-${String(props.seasonYear + 1).slice(2)}` : '')

// Cheap summary + the account's import sources (local Builder projects and
// downloaded community classes), refreshed every open (a community round-trip
// closes/reopens the modal, so the fresh fetch is what surfaces the
// just-imported class).
watch(() => props.show, async (open) => {
  if (!open) return
  classCount.value = null
  try {
    const all = await PlayerRepository.getAllForCampaign(props.campaignId)
    classCount.value = all.filter((p) =>
      (p.isDraftProspect || p.is_draft_prospect)
      && (p.draftYear ?? p.draft_year) === props.draftYear).length
  } catch { /* display-only */ }
  try {
    builderClasses.value = await listDraftClassWorkshopSources()
  } catch {
    builderClasses.value = []
  }
  try {
    const res = await api.get('/api/roster-builds/downloads', {
      params: { type: 'draft_class' },
      skipErrorToast: true,
    })
    downloadedClasses.value = res.data?.builds ?? []
  } catch {
    downloadedClasses.value = []
  }
  if (importedClasses.value.length) selectedBuildId.value = importedClasses.value[0].id
}, { immediate: true })

function applySelected() {
  if (props.busy) return
  const build = importedClasses.value.find((b) => b.id === selectedBuildId.value)
  if (build) emit('apply-imported', build)
}

function close() {
  if (props.busy) return
  emit('continue')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="close">
        <div class="modal-container">
          <header>
            <h2 class="modal-title">{{ $t('Rookie Class') }}</h2>
            <button class="close-btn" @click="close">
              <X :size="20" />
            </button>
          </header>

          <main>
            <p class="intro">
              {{ $t("The {a} scouting board is set — {b} prospects enter the {c} draft at season's end. How do you want this season's rookie class handled?", { a: seasonDisplay, b: classCount ?? '…', c: draftYear }) }}
            </p>

            <button class="option-card" :disabled="busy" @click="emit('continue')">
              <Sparkles :size="18" class="option-icon" />
              <span class="option-text">
                <span class="option-title">{{ $t('Generate & Continue') }}</span>
                <span class="option-desc">{{ $t('Keep the generated class and get on with the season.') }}</span>
              </span>
            </button>

            <button class="option-card" :disabled="busy" @click="emit('edit')">
              <PencilRuler :size="18" class="option-icon" />
              <span class="option-text">
                <span class="option-title">{{ $t('Generate & Edit') }}</span>
                <span class="option-desc">{{ $t('Open the class editor — tweak prospects, reroll the class, or build your own.') }}</span>
              </span>
            </button>

            <div v-if="importedClasses.length" class="option-card import-card">
              <Download :size="18" class="option-icon" />
              <span class="option-text">
                <span class="option-title">{{ $t('Use an Imported Class') }}</span>
                <select v-model="selectedBuildId" class="import-select" :disabled="busy">
                  <option v-for="b in importedClasses" :key="b.id" :value="b.id">
                    {{ b.title }}{{ b._workshopId ? $t(' — Builder project ({n})', { n: b.prospectCount }) : (b.author ? ` — ${b.author}` : '') }}
                  </option>
                </select>
                <button class="apply-btn" :disabled="busy" @click="applySelected">
                  <Loader2 v-if="busy" :size="14" class="spin" />
                  <span v-else>{{ $t('Apply This Class') }}</span>
                </button>
              </span>
            </div>

            <button class="community-link" :disabled="busy" @click="emit('open-community')">
              {{ $t('Browse community draft classes →') }}
            </button>
          </main>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
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

.modal-container {
  background: var(--color-bg-primary, #1a1520);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  width: 100%;
  max-width: 420px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

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

main {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.intro {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  line-height: 1.45;
  margin-bottom: 6px;
}

.option-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}
button.option-card:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  transform: translateY(-1px);
}
.option-card:disabled {
  opacity: 0.6;
  cursor: default;
}

.option-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--color-accent, #e85a4f);
}

.option-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.option-title {
  font-size: 0.9rem;
  font-weight: 700;
}

.option-desc {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  line-height: 1.35;
}

.import-card {
  cursor: default;
}

.import-select {
  width: 100%;
  margin-top: 4px;
  padding: 8px 10px;
  background: var(--color-bg-secondary, #241d2e);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 0.8rem;
}

.apply-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
  padding: 10px;
  background: var(--gradient-cosmic);
  border: none;
  border-radius: var(--radius-md);
  color: black;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s ease;
}
.apply-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}
.apply-btn:disabled {
  opacity: 0.7;
  cursor: default;
}

.community-link {
  align-self: center;
  margin-top: 4px;
  background: none;
  border: none;
  color: var(--color-text-tertiary);
  font-size: 0.78rem;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.community-link:hover:not(:disabled) {
  color: var(--color-text-primary);
}

.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
