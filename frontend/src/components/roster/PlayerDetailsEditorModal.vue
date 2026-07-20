<script setup>
import { ref, computed, reactive } from 'vue'
import { X, Sparkles, Brush, RefreshCw } from 'lucide-vue-next'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'
import { CANONICAL_ATTRIBUTES, normalizePlayerAttributes } from '@/engine/data/attributeSchema'
import { deriveOverallFromAttributes, derivePotential, ensureAttributeCaps } from '@/engine/evolution/PlayerEvolution'
import { detectArchetype, ARCHETYPES, ARCHETYPE_SEEDS, ARCHETYPE_SEED_BASELINE } from '@/engine/data/archetypes'
import { PLAYER_BADGE_LEVELS, compareBadgeLevels, getDerivedMaxBadgeLevel } from '@/engine/data/playerBadgeStore'
import { BADGES } from '@/engine/data/badges'
import { PERSONALITY_TRAITS, pickBadgesByFit, getBadgeLevel, _badgeCountForOvr } from '@/engine/campaign/CampaignManager'

// Tabbed player editor for the Roster Editor — the "everything the attribute
// table doesn't own" modal, styled after the in-game PlayerDetailModal shell
// (glass container, cosmic hero header, pill subtabs). Attributes/ceilings are
// deliberately absent: the bulk table edits those. All writes dual-stamp
// snake_case mirrors so cloud sync (which drops camelCase duplicates) is
// lossless.
const props = defineProps({
  player: { type: Object, required: true },
  campaignId: { type: [String, Number], required: true },
  canEditHeadshot: { type: Boolean, default: false },
})
const emit = defineEmits(['save', 'close', 'edit-headshot'])

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']
const BADGE_STEPS = [null, ...PLAYER_BADGE_LEVELS]
const TRAIT_LABELS = {
  team_player: 'Team Player', ball_hog: 'Ball Hog', mentor: 'Mentor',
  hot_head: 'Hot Head', media_darling: 'Media Darling', quiet: 'Quiet',
  leader: 'Leader', joker: 'Joker', competitor: 'Competitor',
}
const TABS = [
  { key: 'vitals', label: 'Vitals' },
  { key: 'history', label: 'History' },
  { key: 'archetype', label: 'Archetype' },
  { key: 'badges', label: 'Badges' },
  { key: 'contract', label: 'Contract' },
  { key: 'personality', label: 'Personality' },
]

const activeTab = ref('vitals')

// Deep, clone-safe working copy so Cancel discards edits and no Vue proxy
// reaches persistence directly.
const draft = reactive(JSON.parse(JSON.stringify(props.player)))
normalizePlayerAttributes(draft)
ensureAttributeCaps(draft)
if (!draft.attributeCaps) draft.attributeCaps = {}
draft.badgeCaps = draft.badgeCaps ?? {}
draft.personality = draft.personality ?? {}
draft.personality.traits = Array.isArray(draft.personality.traits) ? draft.personality.traits : []

const selectedArchetype = ref('')

// ---- Live derived ----------------------------------------------------------
const liveOverall = computed(() => deriveOverallFromAttributes(draft.attributes, draft.position))
const livePotential = computed(() => derivePotential(draft))
const liveArchetype = computed(() => detectArchetype(draft)?.name ?? 'Role Player')
const heightFtIn = computed(() => {
  const hi = draft.heightInches ?? draft.height_inches ?? 78
  return `${Math.floor(hi / 12)}'${hi % 12}"`
})

// ---- Badges ----------------------------------------------------------------
// Full freedom: every badge, any level, no eligibility gating (the sim reads
// player.badges directly). "Max" is the authored ceiling for the IN-CAMPAIGN
// badge store (player.badgeCaps): Auto = derived as usual; None = locked out.
const BADGE_CATEGORIES = ['finishing', 'shooting', 'playmaking', 'defense', 'physical']

function currentBadgeLevel(badgeId) {
  return (draft.badges ?? []).find((b) => b.id === badgeId)?.level ?? null
}

// Rows shown = the badges the player currently HAS (their derived/authored
// loadout) plus any with a cap override. Insertion-ordered and stable while
// editing; new badges append via the Add Badge picker.
const badgeRowIds = ref([
  ...new Set([
    ...(draft.badges ?? []).map((b) => b.id),
    ...Object.keys(draft.badgeCaps ?? {}),
  ]),
].filter((id) => BADGES.some((b) => b.id === id)))

function badgeDef(id) {
  return BADGES.find((b) => b.id === id)
}

const availableToAdd = computed(() =>
  BADGE_CATEGORIES.map((cat) => ({
    cat,
    badges: BADGES.filter((b) => b.category === cat && !badgeRowIds.value.includes(b.id)),
  })).filter((g) => g.badges.length))

function addBadge(id) {
  if (!id || badgeRowIds.value.includes(id)) return
  badgeRowIds.value = [...badgeRowIds.value, id]
  setBadge(id, 'bronze')
}

function removeBadgeRow(id) {
  setBadge(id, null)
  if (draft.badgeCaps) delete draft.badgeCaps[id]
  badgeRowIds.value = badgeRowIds.value.filter((x) => x !== id)
}

// "Refresh Badges" — REPLACES the loadout with a freshly derived set from the
// generation-time fit picker, run against the player's CURRENT attributes/
// vitals/archetype (count + tier scale with live overall). Manual picks and
// cap overrides are wiped — this is a full re-derive, tweak afterwards.
const suggestNote = ref('')

function refreshBadges() {
  const ovr = liveOverall.value
  const picked = pickBadgesByFit(draft, {
    count: _badgeCountForOvr(ovr),
    tier: getBadgeLevel(ovr),
    archetype: detectArchetype(draft),
  })
  draft.badges = picked.map((b) => ({ id: b.id, level: b.level ?? 'bronze', source: 'authored' }))
  draft.badgeCaps = {}
  badgeRowIds.value = draft.badges.map((b) => b.id)
  suggestNote.value = `Refreshed — ${draft.badges.length} badge${draft.badges.length === 1 ? '' : 's'} derived from this build.`
}

function setBadge(badgeId, level) {
  draft.badges = draft.badges ?? []
  const idx = draft.badges.findIndex((b) => b.id === badgeId)
  if (!level) {
    if (idx >= 0) draft.badges.splice(idx, 1)
    return
  }
  if (idx >= 0) draft.badges[idx] = { ...draft.badges[idx], id: badgeId, level, source: 'authored' }
  else draft.badges.push({ id: badgeId, level, source: 'authored' })
}

function setBadgeCap(badgeId, value) {
  draft.badgeCaps = draft.badgeCaps ?? {}
  if (value === '') delete draft.badgeCaps[badgeId] // Auto (derived)
  else draft.badgeCaps[badgeId] = value             // 'none' | bronze..hof
}

// Live derived ceilings (position pool + attr fit + potential from the
// authored attributes/caps) — shown as the Auto option's value so the user
// starts from the derived caps and only stores explicit overrides.
const derivedCaps = computed(() => {
  const probe = { ...draft, potentialRating: livePotential.value }
  return Object.fromEntries(BADGES.map((b) => [b.id, getDerivedMaxBadgeLevel(probe, b)]))
})

function autoLabel(badgeId) {
  const derived = derivedCaps.value[badgeId]
  return `Auto (${derived ? derived.toUpperCase() : 'NONE'})`
}

// Keep authored ceilings consistent: an explicit cap below the authored level
// (or 'none' with a level set) is raised to the level. Auto entries are left
// absent; an empty map is removed entirely so untouched players keep the
// legacy shape.
function sanitizeBadgeCaps() {
  for (const [id, cap] of Object.entries(draft.badgeCaps)) {
    const level = currentBadgeLevel(id)
    if (!level) continue
    if (cap === 'none' || compareBadgeLevels(cap, level) < 0) draft.badgeCaps[id] = level
  }
  if (!Object.keys(draft.badgeCaps).length) delete draft.badgeCaps
}

// ---- Archetype template ----------------------------------------------------
function applyArchetype() {
  const seed = ARCHETYPE_SEEDS[selectedArchetype.value]
  if (!seed) return
  if (seed.position) draft.position = seed.position
  if (seed.heightInches) { draft.heightInches = seed.heightInches; draft.height_inches = seed.heightInches }
  for (const cat of Object.keys(CANONICAL_ATTRIBUTES)) {
    for (const key of CANONICAL_ATTRIBUTES[cat]) {
      draft.attributes[cat][key] = ARCHETYPE_SEED_BASELINE
    }
  }
  for (const [cat, map] of Object.entries(seed.attrs ?? {})) {
    for (const [key, val] of Object.entries(map)) {
      if (draft.attributes[cat] && key in draft.attributes[cat]) draft.attributes[cat][key] = val
    }
  }
  for (const cat of Object.keys(CANONICAL_ATTRIBUTES)) {
    draft.attributeCaps[cat] = draft.attributeCaps[cat] ?? {}
    for (const key of CANONICAL_ATTRIBUTES[cat]) {
      draft.attributeCaps[cat][key] = Math.min(99, draft.attributes[cat][key] + 8)
    }
  }
}

// ---- Contract --------------------------------------------------------------
const MIN_SALARY = 1_000_000
const MAX_SALARY = 60_000_000

function clampSalary(raw) {
  const v = Number(raw)
  if (!Number.isFinite(v) || v <= 0) return MIN_SALARY
  return Math.round(Math.max(MIN_SALARY, Math.min(MAX_SALARY, v)) / 10_000) * 10_000
}

function resizeSalaries(salaries, years) {
  const out = salaries.slice(0, years)
  while (out.length < years) {
    const last = out[out.length - 1] ?? 4_000_000
    out.push(clampSalary(last * 1.05)) // generator's +5%/yr escalator
  }
  return out
}

function initContract() {
  const years = Math.max(1, Math.min(4, Math.round(Number(draft.contractYearsRemaining ?? draft.contract_years_remaining)) || 1))
  const details = draft.contractDetails ?? draft.contract_details ?? {}
  let salaries = Array.isArray(details.salaries)
    ? details.salaries.map(Number).filter(Number.isFinite).map(clampSalary)
    : []
  if (!salaries.length) {
    const base = clampSalary(draft.contractSalary ?? draft.contract_salary ?? 4_000_000)
    salaries = Array.from({ length: years }, (_, i) => clampSalary(base * (1 + 0.05 * i)))
  }
  const optKey = Object.keys(details.options ?? {})[0]
  return {
    years,
    salaries: resizeSalaries(salaries, years),
    option: optKey ? (details.options[optKey] ?? '') : '',
    noTradeClause: !!details.noTradeClause,
    signedYear: Math.max(2015, Math.min(2025, Math.round(Number(details.signedYear)) || 2025)),
  }
}

const contract = reactive(initContract())

function onYearsChange() {
  contract.years = Math.max(1, Math.min(4, Math.round(Number(contract.years)) || 1))
  contract.salaries = resizeSalaries(contract.salaries, contract.years)
}

function salaryM(i) {
  return (contract.salaries[i] / 1_000_000).toFixed(2)
}

function setSalaryM(i, raw) {
  const m = Number(raw)
  if (Number.isFinite(m) && raw !== '') contract.salaries[i] = clampSalary(m * 1_000_000)
  contract.salaries = [...contract.salaries] // re-render so a blank field resnaps
}

const contractTotal = computed(() => contract.salaries.reduce((s, v) => s + v, 0))

function sanitizeContract() {
  onYearsChange()
  contract.salaries = contract.salaries.map(clampSalary)
  contract.signedYear = Math.max(2015, Math.min(2025, Math.round(Number(contract.signedYear)) || 2025))
  const years = contract.years
  const details = {
    totalYears: years + (contract.option ? 1 : 0),
    salaries: [...contract.salaries],
    options: contract.option ? { [`year${years + 1}`]: contract.option } : {},
    noTradeClause: !!contract.noTradeClause,
    signedYear: contract.signedYear,
  }
  draft.contractYearsRemaining = years
  draft.contract_years_remaining = years
  draft.contractSalary = contract.salaries[0]
  draft.contract_salary = contract.salaries[0]
  draft.contractDetails = details
  draft.contract_details = details
}

// ---- Vitals ----------------------------------------------------------------
function sanitizeVitals() {
  const fix = (val, min, max, fallback) => {
    const v = Math.round(Number(val))
    return Number.isFinite(v) && val !== '' && val !== null
      ? Math.max(min, Math.min(max, v))
      : fallback
  }
  draft.jerseyNumber = fix(draft.jerseyNumber, 0, 99, 0)
  draft.jersey_number = draft.jerseyNumber
  draft.age = fix(draft.age, 18, 44, 25)
  draft.heightInches = fix(draft.heightInches, 66, 90, 78)
  draft.height_inches = draft.heightInches
  draft.height = `${Math.floor(draft.heightInches / 12)}'${draft.heightInches % 12}"`
  draft.weightLbs = fix(draft.weightLbs, 150, 330, 210)
  draft.weight_lbs = draft.weightLbs
  draft.weight = draft.weightLbs
}

function syncName() {
  draft.first_name = draft.firstName
  draft.last_name = draft.lastName
  draft.name = `${draft.firstName ?? ''} ${draft.lastName ?? ''}`.trim()
}

// Keep the position ladder distinct and gapless: no duplicates of the primary,
// and a tertiary without a secondary gets promoted.
function sanitizePositions() {
  let sec = draft.secondaryPosition ?? draft.secondary_position ?? null
  let ter = draft.tertiaryPosition ?? draft.tertiary_position ?? null
  if (sec === draft.position) sec = null
  if (ter === draft.position || ter === sec) ter = null
  if (!sec && ter) { sec = ter; ter = null }
  draft.secondaryPosition = sec
  draft.secondary_position = sec
  draft.tertiaryPosition = ter
  draft.tertiary_position = ter
}

// ---- History (bio & origin) ------------------------------------------------
// Local editing state; written back (flat fields + the nested draftInfo the
// in-game History tab renders) in sanitizeHistory() at save.
const history = reactive({
  college: draft.college ?? draft.school ?? '',
  country: draft.country ?? '',
  draftYear: draft.draftYear ?? draft.draftInfo?.year ?? 2025,
  draftRound: draft.draftRound ?? draft.draftInfo?.round ?? null, // null = undrafted
  draftPick: draft.draftPick ?? draft.draftInfo?.pick ?? null,
  careerSeasons: draft.careerSeasons ?? draft.career_seasons ?? 0,
})

function sanitizeHistory() {
  const fix = (val, min, max, fallback) => {
    const v = Math.round(Number(val))
    return Number.isFinite(v) && val !== '' && val !== null
      ? Math.max(min, Math.min(max, v))
      : fallback
  }
  const college = String(history.college ?? '').trim()
  const country = String(history.country ?? '').trim()
  if (college) draft.college = college
  if (country) draft.country = country

  history.careerSeasons = fix(history.careerSeasons, 0, 25, 0)
  draft.careerSeasons = history.careerSeasons
  draft.career_seasons = history.careerSeasons

  const undrafted = !history.draftRound
  if (undrafted) {
    draft.draftYear = null
    draft.draftRound = null
    draft.draftPick = null
    draft.draftInfo = null
  } else {
    history.draftYear = fix(history.draftYear, 1990, 2025, 2025)
    history.draftRound = fix(history.draftRound, 1, 2, 1)
    history.draftPick = fix(history.draftPick, 1, 60, 1)
    draft.draftYear = history.draftYear
    draft.draftRound = history.draftRound
    draft.draftPick = history.draftPick
    // Nested shape the in-game History tab renders; keep an existing
    // drafted-by abbreviation, else default to the player's current team.
    draft.draftInfo = {
      ...(draft.draftInfo ?? {}),
      year: history.draftYear,
      round: history.draftRound,
      pick: history.draftPick,
      teamAbbreviation: draft.draftInfo?.teamAbbreviation ?? draft.teamAbbreviation ?? draft.team_abbreviation ?? null,
    }
  }
}

// ---- Personality -----------------------------------------------------------
function toggleTrait(trait) {
  const traits = draft.personality.traits
  const i = traits.indexOf(trait)
  if (i >= 0) traits.splice(i, 1)
  else if (traits.length < 3) traits.push(trait)
}

function sanitizePersonality() {
  const p = draft.personality
  const fix = (val, fallback) => {
    const v = Math.round(Number(val))
    return Number.isFinite(v) && val !== '' && val !== null ? Math.max(0, Math.min(99, v)) : fallback
  }
  p.traits = (p.traits ?? []).filter((t) => PERSONALITY_TRAITS.includes(t)).slice(0, 3)
  p.morale = fix(p.morale, 80)
  p.chemistry = fix(p.chemistry, 75)
  if (!['low_key', 'normal', 'high_profile'].includes(p.mediaProfile)) p.mediaProfile = 'normal'
}

// ---- Save ------------------------------------------------------------------
function stampDraft() {
  syncName()
  sanitizePositions()
  sanitizeVitals()
  sanitizeHistory()
  sanitizeContract()
  sanitizePersonality()
  draft.overallRating = liveOverall.value
  draft.overall_rating = liveOverall.value
  draft.potentialRating = livePotential.value
  draft.potential_rating = livePotential.value
  draft.archetype = liveArchetype.value
  sanitizeBadgeCaps()
}

function save() {
  stampDraft()
  emit('save', JSON.parse(JSON.stringify(draft)))
}

function editHeadshot() {
  // Persist current edits first so nothing is lost, then let the host route
  // to the headshot editor.
  stampDraft()
  emit('edit-headshot', JSON.parse(JSON.stringify(draft)))
}

const POSITION_COLORS = {
  PG: '#3b82f6', SG: '#8b5cf6', SF: '#22c55e', PF: '#f59e0b', C: '#ef4444',
}
</script>

<template>
  <Teleport to="body">
    <div class="pdem-overlay" @click.self="emit('close')">
      <div class="pdem-container">
        <!-- Chrome header -->
        <header class="pdem-chrome">
          <h2 class="pdem-title">Edit Player</h2>
          <button class="pdem-close" aria-label="Close" @click="emit('close')">
            <X :size="18" />
          </button>
        </header>

        <main class="pdem-content">
          <!-- Cosmic hero header -->
          <div class="pdem-hero">
            <div class="pdem-avatar">
              <PlayerAvatar :player="draft" :size="72" :campaign-id="campaignId" />
              <button
                v-if="canEditHeadshot"
                class="pdem-edit-headshot"
                title="Edit headshot"
                aria-label="Edit headshot"
                @click.stop="editHeadshot"
              >
                <Brush :size="12" />
              </button>
            </div>
            <div class="pdem-hero-info">
              <h3 class="pdem-hero-name">{{ draft.name || 'New Player' }}</h3>
              <div class="pdem-hero-meta">
                <span class="pdem-pos" :style="{ backgroundColor: POSITION_COLORS[draft.position] ?? '#6B7280' }">
                  {{ draft.position }}
                </span>
                <span class="pdem-arch">{{ liveArchetype }}</span>
              </div>
            </div>
            <div class="pdem-hero-ratings">
              <div class="pdem-rating"><span>OVR</span><strong>{{ liveOverall }}</strong></div>
              <div class="pdem-rating pot"><span>POT</span><strong>{{ livePotential }}</strong></div>
            </div>
          </div>

          <!-- Subtabs -->
          <div class="pdem-tabs">
            <button
              v-for="tab in TABS"
              :key="tab.key"
              class="pdem-tab"
              :class="{ active: activeTab === tab.key }"
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </div>

          <!-- Vitals -->
          <div v-if="activeTab === 'vitals'" class="pdem-panel">
            <div class="pdem-grid two">
              <label class="pdem-field">
                <span>First Name</span>
                <input v-model="draft.firstName" class="pdem-input" @input="syncName" />
              </label>
              <label class="pdem-field">
                <span>Last Name</span>
                <input v-model="draft.lastName" class="pdem-input" @input="syncName" />
              </label>
            </div>
            <div class="pdem-grid">
              <label class="pdem-field">
                <span>Position</span>
                <select v-model="draft.position" class="pdem-input">
                  <option v-for="p in POSITIONS" :key="p" :value="p">{{ p }}</option>
                </select>
              </label>
              <label class="pdem-field">
                <span>2nd Pos</span>
                <select
                  :value="draft.secondaryPosition ?? draft.secondary_position ?? ''"
                  class="pdem-input"
                  @change="draft.secondaryPosition = $event.target.value || null; draft.secondary_position = draft.secondaryPosition"
                >
                  <option value="">None</option>
                  <option v-for="p in POSITIONS.filter(x => x !== draft.position)" :key="p" :value="p">{{ p }}</option>
                </select>
              </label>
              <label class="pdem-field">
                <span>3rd Pos</span>
                <select
                  :value="draft.tertiaryPosition ?? draft.tertiary_position ?? ''"
                  class="pdem-input"
                  @change="draft.tertiaryPosition = $event.target.value || null; draft.tertiary_position = draft.tertiaryPosition"
                >
                  <option value="">None</option>
                  <option
                    v-for="p in POSITIONS.filter(x => x !== draft.position && x !== (draft.secondaryPosition ?? draft.secondary_position))"
                    :key="p"
                    :value="p"
                  >{{ p }}</option>
                </select>
              </label>
              <label class="pdem-field">
                <span>Jersey #</span>
                <input v-model.number="draft.jerseyNumber" type="number" min="0" max="99" class="pdem-input" @input="draft.jersey_number = draft.jerseyNumber" />
              </label>
              <label class="pdem-field">
                <span>Age</span>
                <input v-model.number="draft.age" type="number" min="18" max="44" class="pdem-input" />
              </label>
              <label class="pdem-field">
                <span>Height (in)</span>
                <input v-model.number="draft.heightInches" type="number" min="66" max="90" class="pdem-input" @input="draft.height_inches = draft.heightInches" />
                <em class="pdem-hint">{{ heightFtIn }}</em>
              </label>
              <label class="pdem-field">
                <span>Weight (lbs)</span>
                <input v-model.number="draft.weightLbs" type="number" min="150" max="330" class="pdem-input" @input="draft.weight_lbs = draft.weightLbs; draft.weight = draft.weightLbs" />
              </label>
            </div>
          </div>

          <!-- History (bio & origin) -->
          <div v-else-if="activeTab === 'history'" class="pdem-panel">
            <div class="pdem-grid two">
              <label class="pdem-field">
                <span>College / Club</span>
                <input v-model="history.college" class="pdem-input" placeholder="e.g. Duke" />
              </label>
              <label class="pdem-field">
                <span>Country</span>
                <input v-model="history.country" class="pdem-input" placeholder="e.g. United States" />
              </label>
            </div>
            <div class="pdem-grid">
              <label class="pdem-field">
                <span>Draft Round</span>
                <select
                  :value="history.draftRound ?? ''"
                  class="pdem-input"
                  @change="history.draftRound = $event.target.value ? Number($event.target.value) : null"
                >
                  <option value="">Undrafted</option>
                  <option :value="1">1</option>
                  <option :value="2">2</option>
                </select>
              </label>
              <template v-if="history.draftRound">
                <label class="pdem-field">
                  <span>Pick</span>
                  <input v-model.number="history.draftPick" type="number" min="1" max="60" class="pdem-input" />
                </label>
                <label class="pdem-field">
                  <span>Draft Year</span>
                  <input v-model.number="history.draftYear" type="number" min="1990" max="2025" class="pdem-input" />
                </label>
              </template>
              <label class="pdem-field">
                <span>Career Seasons</span>
                <input v-model.number="history.careerSeasons" type="number" min="0" max="25" class="pdem-input" />
              </label>
            </div>
          </div>

          <!-- Archetype -->
          <div v-else-if="activeTab === 'archetype'" class="pdem-panel">
            <div class="pdem-current-arch">
              Detected archetype: <strong>{{ liveArchetype }}</strong>
            </div>
            <p class="pdem-note">
              Applying a template overwrites the player's current attributes and
              re-seeds their growth ceilings around it — then fine-tune in the table.
            </p>
            <div class="pdem-arch-row">
              <Sparkles :size="14" />
              <select v-model="selectedArchetype" class="pdem-input grow">
                <option value="">Choose an archetype template…</option>
                <option v-for="a in ARCHETYPES.filter(x => ARCHETYPE_SEEDS[x.id])" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
              <button class="pdem-apply" :disabled="!selectedArchetype" @click="applyArchetype">Apply</button>
            </div>
          </div>

          <!-- Badges — the player's loadout + Add Badge -->
          <div v-else-if="activeTab === 'badges'" class="pdem-panel">
            <div class="pdem-suggest-row top">
              <button class="pdem-apply" @click="refreshBadges">
                <RefreshCw :size="13" /> Refresh Badges
              </button>
              <span v-if="suggestNote" class="pdem-suggest-note">{{ suggestNote }}</span>
            </div>
            <p class="pdem-note">
              <strong>Max</strong> caps what the in-game badge store can upgrade to
              during the campaign — Auto shows the derived cap; pick a level (or None)
              to override it.
            </p>
            <p v-if="!badgeRowIds.length" class="pdem-note">No badges yet — add one below.</p>
            <div v-for="id in badgeRowIds" :key="id" class="pdem-badge-row">
              <div class="pdem-badge-info">
                <span class="pdem-badge-name">{{ badgeDef(id)?.name ?? id }}</span>
                <span class="pdem-badge-cat pdem-badge-desc">{{ badgeDef(id)?.description }}</span>
              </div>
              <div class="pdem-badge-selects">
                <label class="pdem-badge-select">
                  <span>Lvl</span>
                  <select
                    class="pdem-input sm"
                    :value="currentBadgeLevel(id) ?? ''"
                    @change="setBadge(id, $event.target.value || null)"
                  >
                    <option v-for="lvl in BADGE_STEPS" :key="lvl ?? 'none'" :value="lvl ?? ''">
                      {{ lvl ? lvl.toUpperCase() : 'None' }}
                    </option>
                  </select>
                </label>
                <label class="pdem-badge-select">
                  <span>Max</span>
                  <select
                    class="pdem-input sm"
                    :value="draft.badgeCaps?.[id] ?? ''"
                    @change="setBadgeCap(id, $event.target.value)"
                  >
                    <option value="">{{ autoLabel(id) }}</option>
                    <option value="none">None</option>
                    <option v-for="lvl in PLAYER_BADGE_LEVELS" :key="lvl" :value="lvl">
                      {{ lvl.toUpperCase() }}
                    </option>
                  </select>
                </label>
                <button class="pdem-badge-remove" title="Remove badge" @click="removeBadgeRow(id)">
                  <X :size="13" />
                </button>
              </div>
            </div>

            <label class="pdem-add-badge">
              <span>Add Badge</span>
              <select
                class="pdem-input"
                :value="''"
                @change="addBadge($event.target.value); $event.target.value = ''"
              >
                <option value="" disabled>+ Choose a badge…</option>
                <optgroup v-for="g in availableToAdd" :key="g.cat" :label="g.cat">
                  <option v-for="b in g.badges" :key="b.id" :value="b.id">{{ b.name }}</option>
                </optgroup>
              </select>
            </label>
          </div>

          <!-- Contract -->
          <div v-else-if="activeTab === 'contract'" class="pdem-panel">
            <p v-if="draft.isFreeAgent" class="pdem-note">
              Market value — the contract follows the player when drafted.
            </p>
            <div class="pdem-grid">
              <label class="pdem-field">
                <span>Years</span>
                <select v-model.number="contract.years" class="pdem-input" @change="onYearsChange">
                  <option v-for="y in 4" :key="y" :value="y">{{ y }}</option>
                </select>
              </label>
              <label class="pdem-field">
                <span>Option (yr {{ contract.years + 1 }})</span>
                <select v-model="contract.option" class="pdem-input">
                  <option value="">None</option>
                  <option value="player">Player</option>
                  <option value="team">Team</option>
                </select>
              </label>
              <label class="pdem-field">
                <span>Signed</span>
                <input v-model.number="contract.signedYear" type="number" min="2015" max="2025" class="pdem-input" />
              </label>
              <label class="pdem-field pdem-ntc">
                <span>No-Trade</span>
                <input v-model="contract.noTradeClause" type="checkbox" class="pdem-check" />
              </label>
            </div>
            <div class="pdem-salaries">
              <div v-for="(s, i) in contract.salaries" :key="i" class="pdem-salary-row">
                <span>Year {{ i + 1 }}{{ i === 0 ? ' (this season)' : '' }}</span>
                <span class="pdem-salary-input">
                  $<input
                    type="number" min="1" max="60" step="0.1" class="pdem-input sm"
                    :value="salaryM(i)"
                    @change="setSalaryM(i, $event.target.value)"
                  />M
                </span>
              </div>
            </div>
            <p class="pdem-contract-total">
              Total: ${{ (contractTotal / 1_000_000).toFixed(1) }}M over {{ contract.years }} yr{{ contract.years > 1 ? 's' : '' }}
            </p>
          </div>

          <!-- Personality -->
          <div v-else class="pdem-panel">
            <h4 class="pdem-section-title">Traits <em>(up to 3)</em></h4>
            <div class="pdem-traits">
              <button
                v-for="t in PERSONALITY_TRAITS"
                :key="t"
                class="pdem-trait"
                :class="{ on: draft.personality.traits.includes(t) }"
                @click="toggleTrait(t)"
              >
                {{ TRAIT_LABELS[t] ?? t }}
              </button>
            </div>
            <div class="pdem-grid" style="margin-top: 14px;">
              <label class="pdem-field">
                <span>Morale</span>
                <input v-model.number="draft.personality.morale" type="number" min="0" max="99" class="pdem-input" />
              </label>
              <label class="pdem-field">
                <span>Chemistry</span>
                <input v-model.number="draft.personality.chemistry" type="number" min="0" max="99" class="pdem-input" />
              </label>
              <label class="pdem-field">
                <span>Media Profile</span>
                <select v-model="draft.personality.mediaProfile" class="pdem-input">
                  <option value="low_key">Low-key</option>
                  <option value="normal">Normal</option>
                  <option value="high_profile">High-profile</option>
                </select>
              </label>
            </div>
          </div>
        </main>

        <footer class="pdem-foot">
          <button class="pdem-cancel" @click="emit('close')">Cancel</button>
          <button class="pdem-save" @click="save">Save Player</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pdem-overlay {
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

.pdem-container {
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
  animation: pdem-in 0.18s ease;
}

@keyframes pdem-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

.pdem-chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.pdem-title {
  margin: 0;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.4rem;
  font-weight: 400;
  color: var(--color-text-primary);
}

.pdem-close {
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

.pdem-close:hover {
  background: var(--color-bg-tertiary);
}

.pdem-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  scrollbar-width: none;
}

.pdem-content::-webkit-scrollbar {
  display: none;
}

/* Cosmic hero (PDM recipe) */
.pdem-hero {
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

.pdem-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.7), transparent),
    radial-gradient(1px 1px at 60% 70%, rgba(255,255,255,0.5), transparent),
    radial-gradient(1.5px 1.5px at 85% 25%, rgba(255,255,255,0.6), transparent);
  pointer-events: none;
}

.pdem-hero > * {
  position: relative;
  z-index: 1;
}

.pdem-avatar {
  position: relative;
  flex-shrink: 0;
}

.pdem-edit-headshot {
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

.pdem-hero-info {
  min-width: 0;
  flex: 1;
}

.pdem-hero-name {
  margin: 0 0 4px;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.3rem;
  font-weight: 400;
  color: #1a1520;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pdem-hero-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pdem-pos {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 0.66rem;
  font-weight: 800;
  color: #fff;
}

.pdem-arch {
  font-size: 0.72rem;
  font-weight: 700;
  color: rgba(26, 21, 32, 0.75);
}

.pdem-hero-ratings {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.pdem-rating {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(26, 21, 32, 0.75);
}

.pdem-rating span {
  font-size: 0.55rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.65);
}

.pdem-rating strong {
  font-size: 1.05rem;
  color: #fff;
}

.pdem-rating.pot strong {
  color: var(--color-success-light, #4ade80);
}

/* Tab pills (PDM recipe) */
.pdem-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 4px 0 12px;
}

.pdem-tab {
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

.pdem-tab.active {
  background: var(--gradient-cosmic);
  border-color: rgba(255, 255, 255, 0.2);
  color: #1a1520;
  font-weight: 700;
}

.pdem-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 180px;
}

.pdem-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.pdem-grid.two > .pdem-field {
  flex: 1;
  min-width: 140px;
}

.pdem-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.66rem;
  color: var(--color-text-secondary);
}

.pdem-field span {
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.pdem-hint {
  font-style: normal;
  font-size: 0.62rem;
  color: var(--color-text-tertiary);
}

.pdem-input {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 0.9rem;
  min-width: 0;
}

.pdem-input.sm {
  padding: 5px 8px;
  width: 84px;
  font-size: 0.82rem;
}

.pdem-input.grow {
  flex: 1;
}

.pdem-check {
  width: 18px;
  height: 18px;
  accent-color: var(--color-primary);
}

.pdem-ntc {
  align-items: flex-start;
  justify-content: flex-end;
}

.pdem-note {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.pdem-current-arch {
  font-size: 0.9rem;
  color: var(--color-text-primary);
}

.pdem-arch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
}

.pdem-apply {
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid rgba(232, 90, 79, 0.4);
  background: rgba(232, 90, 79, 0.14);
  color: var(--color-primary);
  font-weight: 700;
  cursor: pointer;
}

.pdem-apply:disabled {
  opacity: 0.5;
  cursor: default;
}

.pdem-badge-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  align-self: flex-end;
  border-radius: 6px;
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-error);
  cursor: pointer;
  flex-shrink: 0;
}

.pdem-suggest-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.pdem-suggest-row.top {
  margin-top: 0;
}

.pdem-suggest-row .pdem-apply {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.pdem-suggest-note {
  font-size: 0.74rem;
  color: var(--color-text-secondary);
}

.pdem-add-badge {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
  font-size: 0.66rem;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  font-weight: 700;
}

.pdem-add-badge optgroup {
  text-transform: capitalize;
}

.pdem-badge-selects {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.pdem-badge-select {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.58rem;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  font-weight: 700;
}

.pdem-badge-desc {
  display: block;
  max-width: 260px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: none;
}

.pdem-badge-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--glass-border);
}

.pdem-badge-name {
  display: block;
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.pdem-badge-cat {
  font-size: 0.66rem;
  color: var(--color-text-tertiary);
  text-transform: capitalize;
}

.pdem-salaries {
  display: flex;
  flex-direction: column;
}

.pdem-salary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--glass-border);
  font-size: 0.84rem;
  color: var(--color-text-primary);
}

.pdem-salary-input {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.pdem-contract-total {
  margin: 4px 0 0;
  text-align: right;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.pdem-section-title {
  margin: 0;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}

.pdem-section-title em {
  font-style: normal;
  opacity: 0.7;
  text-transform: none;
}

.pdem-traits {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pdem-trait {
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--color-text-secondary);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.pdem-trait.on {
  background: rgba(232, 90, 79, 0.16);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.pdem-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.pdem-cancel {
  padding: 10px 18px;
  border-radius: var(--radius-xl, 14px);
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  font-weight: 600;
  cursor: pointer;
}

.pdem-save {
  padding: 10px 20px;
  border-radius: var(--radius-xl, 14px);
  background: var(--color-primary);
  border: none;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.pdem-save:hover {
  background: var(--color-primary-light);
}
</style>
