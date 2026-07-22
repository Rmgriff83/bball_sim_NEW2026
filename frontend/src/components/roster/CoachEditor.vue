<script setup>
// Coach editor (Custom Roster editor) — same shell/hero/tab treatment as
// PlayerDetailsEditorModal (cee-* classes mirror the pdem-* styles) so the
// two edit popups read as one family. Works on the whole TEAM (coach is
// embedded); emits `save` with the cloned team, parent persists.
import { reactive, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { X, Brush } from 'lucide-vue-next'
import CoachAvatar from '@/components/common/CoachAvatar.vue'
import { OFFENSIVE_SCHEMES, DEFENSIVE_SCHEMES } from '@/engine/simulation/CoachingEngine'
import { coachBadges, COACH_BADGE_LEVELS } from '@/engine/data/coachBadges'
import { COACH_ATTRIBUTES, computeCoachTier } from '@/engine/data/coaches'
import { useHeadshotEditorReturnStore } from '@/stores/headshotEditorReturn'

const props = defineProps({
  team: { type: Object, required: true },
  campaignId: { type: [String, Number], required: true },
  canEditHeadshot: { type: Boolean, default: false },
})
const emit = defineEmits(['save', 'close'])
const router = useRouter()

const TABS = [
  { key: 'info', label: 'Info' },
  { key: 'schemes', label: 'Schemes' },
  { key: 'attributes', label: 'Attributes' },
  { key: 'perks', label: 'Perks' },
]
const activeTab = ref('info')

const BADGE_STEPS = [null, ...COACH_BADGE_LEVELS]
const ATTR_LABELS = {
  offensiveIQ: 'Offensive IQ', defensiveIQ: 'Defensive IQ',
  playerDevelopment: 'Player Development', strictness: 'Strictness', gameManagement: 'Game Management',
}
const offensiveSchemeOptions = Object.entries(OFFENSIVE_SCHEMES).map(([id, s]) => ({ id, name: s.name }))
const defensiveSchemeOptions = Object.entries(DEFENSIVE_SCHEMES).map(([id, s]) => ({ id, name: s.name }))

// Clone-safe working copy of the whole team (coach is embedded).
const draft = reactive(JSON.parse(JSON.stringify(props.team)))
if (!draft.coach) draft.coach = {}
const coach = draft.coach
coach.attributes = coach.attributes ?? {}
for (const a of COACH_ATTRIBUTES) if (typeof coach.attributes[a] !== 'number') coach.attributes[a] = 70
coach.badges = coach.badges ?? []
draft.coaching_scheme = draft.coaching_scheme ?? { offensive: 'balanced', defensive: 'man', substitution: 'staggered' }
// Seed scheme selectors from the coach's own scheme fields when present.
const offScheme = coach.offensiveScheme ?? coach.offensive_scheme ?? draft.coaching_scheme.offensive ?? 'balanced'
const defScheme = coach.defensiveScheme ?? coach.defensive_scheme ?? draft.coaching_scheme.defensive ?? 'man'
coach.offensiveScheme = offScheme; coach.offensive_scheme = offScheme
coach.defensiveScheme = defScheme; coach.defensive_scheme = defScheme

// Silent-discard guard (mirrors PlayerDetailsEditorModal): snapshot the draft
// AFTER the seeding above; any close request with a changed draft asks first.
const _initialSnapshot = JSON.stringify(draft)
const confirmDiscard = ref(false)

function requestClose() {
  if (JSON.stringify(draft) !== _initialSnapshot) {
    confirmDiscard.value = true
    return
  }
  emit('close')
}

const liveOverall = computed(() => {
  const vals = COACH_ATTRIBUTES.map((a) => Number(coach.attributes[a]) || 0)
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
})
const liveTier = computed(() => {
  try { return computeCoachTier({ ...coach, overallRating: liveOverall.value }) } catch { return coach.tier ?? '—' }
})
const liveName = computed(() =>
  `${coach.firstName ?? ''} ${coach.lastName ?? ''}`.trim() || coach.name || 'New Coach')
const offSchemeName = computed(() =>
  OFFENSIVE_SCHEMES[coach.offensiveScheme]?.name ?? coach.offensiveScheme ?? '')

function coachBadgeLevel(id) {
  return coach.badges.find((b) => b.id === id)?.level ?? null
}
function setCoachBadge(id, level) {
  const idx = coach.badges.findIndex((b) => b.id === id)
  if (!level) { if (idx >= 0) coach.badges.splice(idx, 1); return }
  if (idx >= 0) coach.badges[idx] = { ...coach.badges[idx], id, level, source: 'authored' }
  else coach.badges.push({ id, level, source: 'authored' })
}
function clampAttr(a, raw) {
  let v = Math.round(Number(raw)); if (!Number.isFinite(v)) v = 40
  coach.attributes[a] = Math.max(25, Math.min(99, v))
}

function applyBeforeSave() {
  const ovr = liveOverall.value
  coach.overallRating = ovr; coach.overall_rating = ovr
  coach.offensive_scheme = coach.offensiveScheme
  coach.defensive_scheme = coach.defensiveScheme
  // Mirror the team-level scheme the sim actually reads.
  draft.coaching_scheme = {
    ...(draft.coaching_scheme ?? {}),
    offensive: coach.offensiveScheme,
    defensive: coach.defensiveScheme,
    substitution: draft.coaching_scheme?.substitution ?? 'staggered',
  }
  try { coach.tier = computeCoachTier(coach) } catch { /* keep existing tier */ }
  coach.name = `${coach.firstName ?? ''} ${coach.lastName ?? ''}`.trim() || coach.name
}

function editHeadshot() {
  applyBeforeSave()
  emit('save', JSON.parse(JSON.stringify(draft)))
  const returnStore = useHeadshotEditorReturnStore()
  returnStore.capture({ routeName: 'roster-setup', routeParams: { id: props.campaignId }, playerId: coach.id })
  router.push({ name: 'coach-headshot-editor', params: { id: props.campaignId, coachId: coach.id } })
}

function save() {
  applyBeforeSave()
  emit('save', JSON.parse(JSON.stringify(draft)))
}
</script>

<template>
  <Teleport to="body">
    <div class="cee-overlay" @click.self="requestClose">
      <div class="cee-container">
        <header class="cee-chrome">
          <h2 class="cee-title">Edit Coach</h2>
          <button class="cee-close" aria-label="Close" @click="requestClose"><X :size="18" /></button>
        </header>

        <main class="cee-content">
          <!-- Cosmic hero header -->
          <div class="cee-hero">
            <div class="cee-avatar">
              <CoachAvatar :coach="coach" :size="72" :campaign-id="campaignId" :editable="false" />
              <button
                v-if="canEditHeadshot"
                class="cee-edit-headshot"
                title="Edit headshot"
                aria-label="Edit headshot"
                @click.stop="editHeadshot"
              >
                <Brush :size="12" />
              </button>
            </div>
            <div class="cee-hero-info">
              <h3 class="cee-hero-name">{{ liveName }}</h3>
              <div class="cee-hero-meta">
                <span class="cee-role">HC</span>
                <span class="cee-scheme">{{ offSchemeName }}</span>
              </div>
            </div>
            <div class="cee-hero-ratings">
              <div class="cee-rating"><span>OVR</span><strong>{{ liveOverall }}</strong></div>
              <div class="cee-rating tier"><span>TIER</span><strong>{{ liveTier }}</strong></div>
            </div>
          </div>

          <!-- Subtabs -->
          <div class="cee-tabs">
            <button
              v-for="tab in TABS"
              :key="tab.key"
              class="cee-tab"
              :class="{ active: activeTab === tab.key }"
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </div>

          <!-- Info -->
          <div v-if="activeTab === 'info'" class="cee-panel">
            <div class="cee-grid two">
              <label class="cee-field">
                <span>First Name</span>
                <input v-model="coach.firstName" class="cee-input" placeholder="First" />
              </label>
              <label class="cee-field">
                <span>Last Name</span>
                <input v-model="coach.lastName" class="cee-input" placeholder="Last" />
              </label>
            </div>
          </div>

          <!-- Schemes -->
          <div v-else-if="activeTab === 'schemes'" class="cee-panel">
            <div class="cee-grid two">
              <label class="cee-field">
                <span>Offensive Scheme</span>
                <select v-model="coach.offensiveScheme" class="cee-input">
                  <option v-for="o in offensiveSchemeOptions" :key="o.id" :value="o.id">{{ o.name }}</option>
                </select>
              </label>
              <label class="cee-field">
                <span>Defensive Scheme</span>
                <select v-model="coach.defensiveScheme" class="cee-input">
                  <option v-for="d in defensiveSchemeOptions" :key="d.id" :value="d.id">{{ d.name }}</option>
                </select>
              </label>
            </div>
          </div>

          <!-- Attributes -->
          <div v-else-if="activeTab === 'attributes'" class="cee-panel">
            <div v-for="a in COACH_ATTRIBUTES" :key="a" class="cee-row">
              <span class="cee-row-name">{{ ATTR_LABELS[a] ?? a }}</span>
              <input
                type="number"
                min="25"
                max="99"
                class="cee-input sm"
                :value="coach.attributes[a]"
                @input="clampAttr(a, $event.target.value)"
              />
            </div>
          </div>

          <!-- Perks -->
          <div v-else-if="activeTab === 'perks'" class="cee-panel">
            <div v-for="b in coachBadges" :key="b.id" class="cee-row">
              <span class="cee-row-name">{{ b.name }}</span>
              <select
                class="cee-input sm"
                :value="coachBadgeLevel(b.id) ?? ''"
                @change="setCoachBadge(b.id, $event.target.value || null)"
              >
                <option v-for="lvl in BADGE_STEPS" :key="lvl ?? 'none'" :value="lvl ?? ''">
                  {{ lvl ? lvl.toUpperCase() : 'None' }}
                </option>
              </select>
            </div>
          </div>
        </main>

        <footer class="cee-foot">
          <button class="cee-cancel" @click="requestClose">Cancel</button>
          <button class="cee-save" @click="save">Save Coach</button>
        </footer>

        <!-- Unsaved-changes discard confirm -->
        <div v-if="confirmDiscard" class="cee-discard-overlay">
          <div class="cee-discard-box">
            <p>Discard unsaved changes to this coach?</p>
            <div class="cee-discard-actions">
              <button class="cee-save" @click="confirmDiscard = false">Keep editing</button>
              <button class="cee-cancel cee-discard-confirm" @click="confirmDiscard = false; emit('close')">
                Discard
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Shell — mirrors PlayerDetailsEditorModal's pdem-* styles. */
.cee-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
}

.cee-container {
  position: relative; /* anchors the discard-confirm overlay */
  width: 100%;
  max-width: 42rem;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--glass-bg-elevated, rgba(30, 35, 45, 0.98));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl, 20px);
  box-shadow: var(--shadow-lg);
  animation: cee-in 0.18s ease;
}

@keyframes cee-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

.cee-chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.cee-title {
  margin: 0;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.4rem;
  font-weight: 400;
  color: var(--color-text-primary);
}

.cee-close {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cee-close:hover { background: var(--color-bg-tertiary); }

.cee-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  scrollbar-width: none;
}

.cee-content::-webkit-scrollbar { display: none; }

/* Cosmic hero */
.cee-hero {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-xl, 16px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: var(--gradient-cosmic);
  overflow: hidden;
  margin-bottom: 12px;
}

.cee-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1px 1px at 20% 30%, rgba(255, 255, 255, 0.7), transparent),
    radial-gradient(1px 1px at 60% 70%, rgba(255, 255, 255, 0.5), transparent),
    radial-gradient(1.5px 1.5px at 85% 25%, rgba(255, 255, 255, 0.6), transparent);
  pointer-events: none;
}

.cee-hero > * { position: relative; z-index: 1; }

.cee-avatar { position: relative; flex-shrink: 0; }

.cee-edit-headshot {
  position: absolute;
  bottom: -2px;
  left: -2px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  border: 2px solid var(--color-bg-secondary);
  color: #fff;
  cursor: pointer;
  padding: 0;
}

.cee-hero-info { min-width: 0; flex: 1; }

.cee-hero-name {
  margin: 0 0 4px;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.3rem;
  font-weight: 400;
  color: #1a1520;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cee-hero-meta { display: flex; align-items: center; gap: 6px; }

.cee-role {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 0.66rem;
  font-weight: 800;
  color: #fff;
  background: rgba(26, 21, 32, 0.55);
}

.cee-scheme {
  font-size: 0.72rem;
  font-weight: 700;
  color: rgba(26, 21, 32, 0.75);
}

.cee-hero-ratings { display: flex; gap: 6px; flex-shrink: 0; }

.cee-rating {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(26, 21, 32, 0.75);
}

.cee-rating span {
  font-size: 0.55rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.65);
}

.cee-rating strong { font-size: 1.05rem; color: #fff; }

.cee-rating.tier strong {
  color: var(--color-success-light, #4ade80);
  text-transform: capitalize;
}

/* Tabs */
.cee-tabs { display: flex; flex-wrap: wrap; gap: 0.5rem; padding: 4px 0 12px; }

.cee-tab {
  padding: 0.45rem 0.9rem;
  border-radius: var(--radius-lg, 12px);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  font-size: 0.78rem;
  cursor: pointer;
}

.cee-tab.active {
  background: var(--gradient-cosmic);
  border-color: rgba(255, 255, 255, 0.2);
  color: #1a1520;
  font-weight: 700;
}

.cee-panel { display: flex; flex-direction: column; gap: 10px; min-height: 180px; }

/* Fields */
.cee-grid { display: flex; flex-wrap: wrap; gap: 10px; }

.cee-grid.two > .cee-field { flex: 1; min-width: 140px; }

.cee-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.66rem;
  color: var(--color-text-secondary);
}

.cee-field span {
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.cee-input {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 0.9rem;
  min-width: 0;
}

.cee-input.sm {
  padding: 5px 8px;
  width: 100px;
  font-size: 0.82rem;
}

/* Attribute / perk rows */
.cee-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--glass-border);
}

.cee-row-name {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

/* Footer */
.cee-discard-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  padding: 20px;
}

.cee-discard-box {
  background: var(--glass-bg-elevated, var(--color-bg-secondary));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl, 16px);
  padding: 20px;
  max-width: 320px;
  text-align: center;
}

.cee-discard-box p {
  margin: 0 0 14px;
  font-size: 0.92rem;
  color: var(--color-text-primary);
}

.cee-discard-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.cee-discard-confirm {
  border-color: rgba(239, 68, 68, 0.5);
  color: var(--color-error, #ef4444);
}

.cee-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.cee-cancel {
  padding: 10px 18px;
  border-radius: var(--radius-xl, 14px);
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  font-weight: 600;
  cursor: pointer;
}

.cee-save {
  padding: 10px 20px;
  border-radius: var(--radius-xl, 14px);
  background: var(--color-primary);
  border: none;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.cee-save:hover { background: var(--color-primary-light); }
</style>
