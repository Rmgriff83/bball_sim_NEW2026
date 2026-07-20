<script setup>
import { reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { X, Image } from 'lucide-vue-next'
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

const liveOverall = computed(() => {
  const vals = COACH_ATTRIBUTES.map((a) => Number(coach.attributes[a]) || 0)
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
})
const liveTier = computed(() => {
  try { return computeCoachTier({ ...coach, overallRating: liveOverall.value }) } catch { return coach.tier ?? '—' }
})

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
  <div class="ce-overlay" @click.self="emit('close')">
    <div class="ce-panel">
      <header class="ce-head">
        <div class="ce-identity">
          <input v-model="coach.firstName" class="ce-name-input" placeholder="First" />
          <input v-model="coach.lastName" class="ce-name-input" placeholder="Last" />
        </div>
        <button class="ce-close" @click="emit('close')"><X :size="20" /></button>
      </header>

      <div class="ce-derived">
        <div class="ce-chip"><span>OVR</span><strong>{{ liveOverall }}</strong></div>
        <div class="ce-chip"><span>Tier</span><strong>{{ liveTier }}</strong></div>
        <button v-if="canEditHeadshot" class="ce-headshot-btn" @click="editHeadshot">
          <Image :size="14" /> Headshot
        </button>
      </div>

      <div class="ce-schemes">
        <label class="ce-field">
          <span>Offensive Scheme</span>
          <select v-model="coach.offensiveScheme" class="ce-select">
            <option v-for="o in offensiveSchemeOptions" :key="o.id" :value="o.id">{{ o.name }}</option>
          </select>
        </label>
        <label class="ce-field">
          <span>Defensive Scheme</span>
          <select v-model="coach.defensiveScheme" class="ce-select">
            <option v-for="d in defensiveSchemeOptions" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
        </label>
      </div>

      <section class="ce-attrs">
        <h4>Attributes</h4>
        <div v-for="a in COACH_ATTRIBUTES" :key="a" class="ce-attr-row">
          <span class="ce-attr-label">{{ ATTR_LABELS[a] ?? a }}</span>
          <input type="number" min="25" max="99" class="ce-num" :value="coach.attributes[a]" @input="clampAttr(a, $event.target.value)" />
        </div>
      </section>

      <section class="ce-badges">
        <h4>Coach Perks</h4>
        <div v-for="b in coachBadges" :key="b.id" class="ce-badge-row">
          <span class="ce-badge-name">{{ b.name }}</span>
          <select class="ce-select" :value="coachBadgeLevel(b.id) ?? ''" @change="setCoachBadge(b.id, $event.target.value || null)">
            <option v-for="lvl in BADGE_STEPS" :key="lvl ?? 'none'" :value="lvl ?? ''">{{ lvl ? lvl.toUpperCase() : 'None' }}</option>
          </select>
        </div>
      </section>

      <footer class="ce-foot">
        <button class="ce-cancel" @click="emit('close')">Cancel</button>
        <button class="ce-save" @click="save">Save Coach</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.ce-overlay { position: fixed; inset: 0; z-index: 45; display: flex; align-items: flex-start; justify-content: center; background: rgba(0,0,0,0.65); padding: 16px; overflow-y: auto; }
.ce-panel { width: 100%; max-width: 480px; margin: 24px 0; background: var(--color-surface,#161a22); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 18px; }
.ce-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ce-identity { display: flex; gap: 8px; flex: 1; }
.ce-name-input { flex: 1; min-width: 0; background: rgba(255,255,255,0.06); color: inherit; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 8px 10px; font-weight: 700; }
.ce-close { background: none; border: none; color: inherit; cursor: pointer; opacity: 0.7; }
.ce-derived { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
.ce-chip { display: flex; flex-direction: column; align-items: center; padding: 6px 14px; border-radius: 10px; background: rgba(79,140,255,0.12); border: 1px solid rgba(79,140,255,0.25); }
.ce-chip span { font-size: 0.62rem; opacity: 0.7; text-transform: uppercase; }
.ce-chip strong { font-size: 1.1rem; text-transform: capitalize; }
.ce-headshot-btn { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; background: rgba(255,255,255,0.08); color: inherit; border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; padding: 7px 12px; font-weight: 600; cursor: pointer; }
.ce-schemes { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }
@media (max-width: 480px) { .ce-schemes { grid-template-columns: 1fr; } }
.ce-field { display: flex; flex-direction: column; gap: 4px; font-size: 0.7rem; opacity: 0.85; }
.ce-field span { text-transform: uppercase; }
.ce-select, .ce-num { background: rgba(255,255,255,0.06); color: inherit; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 7px 9px; font-size: 0.9rem; }
.ce-attrs, .ce-badges { margin-top: 18px; }
.ce-attrs h4, .ce-badges h4 { margin: 0 0 8px; font-size: 0.9rem; }
.ce-attr-row, .ce-badge-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 5px 0; border-top: 1px solid rgba(255,255,255,0.06); }
.ce-attr-label, .ce-badge-name { font-size: 0.86rem; font-weight: 600; }
.ce-num { width: 70px; text-align: center; }
.ce-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
.ce-cancel { background: rgba(255,255,255,0.08); color: inherit; border: none; border-radius: 10px; padding: 10px 16px; font-weight: 600; cursor: pointer; }
.ce-save { background: var(--color-primary,#4f8cff); color: #fff; border: none; border-radius: 10px; padding: 10px 18px; font-weight: 700; cursor: pointer; }
</style>
