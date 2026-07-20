<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { useRosterEditorStore } from '@/stores/rosterEditor'
import { useAuthStore } from '@/stores/auth'
import { useCampaignStore } from '@/stores/campaign'
import { useHeadshotEditorReturnStore } from '@/stores/headshotEditorReturn'
import { storeToRefs } from 'pinia'
import { Loader2, Users, ClipboardList, ShieldCheck, ArrowLeft, AlertTriangle, Check, Plus, Save, Globe, Download } from 'lucide-vue-next'
import { Capacitor } from '@capacitor/core'
import api from '@/composables/useApi'
import RosterAttributeTable from '@/components/roster/RosterAttributeTable.vue'
import SelectedPlayerHeader from '@/components/roster/SelectedPlayerHeader.vue'
import PlayerDetailsEditorModal from '@/components/roster/PlayerDetailsEditorModal.vue'
import CoachEditor from '@/components/roster/CoachEditor.vue'
import PositionFilterBar from '@/components/trade/PositionFilterBar.vue'
import TeamLogo from '@/components/common/TeamLogo.vue'
import { SALARY_CAP, LUXURY_TAX } from '@/engine/data/salaryScale'
import { MAX_ROSTER_SIZE } from '@/engine/finance/FinanceManager'

const route = useRoute()
const router = useRouter()
const store = useRosterEditorStore()
const authStore = useAuthStore()
const {
  teams, activeTeam, activeRoster, freeAgents, isFantasy, hasStarted,
  userTeamId, loading, saving, error, selectedId, selectedPlayer, isDirty, dirtyIds,
} = storeToRefs(store)

const campaignId = computed(() => route.params.id)
const view = ref('teams')          // 'teams' | 'roster' | 'pool'
const tableMode = ref('current')   // 'current' | 'ceiling'
const editingPlayer = ref(null)
const editingCoachTeam = ref(null)
const showAck = ref(false)
const ackConfirmed = ref(false)
const showFinalize = ref(false)
const finalizeProblems = ref([])
const validating = ref(false)
const ACK_KEY = 'customRosterAckAccepted'

// Unsaved-changes guard: when set, the guard modal is open and this callback
// runs after the user picks Save or Discard.
const pendingGuardAction = ref(null)

const hasHeadshotEditor = computed(() => authStore.hasFeature('headshot_editor'))
// Position filter pills ('all' shows the full roster). Tapping a position
// shows ONLY players who can play it (primary, secondary, or tertiary) —
// primaries first (best OVR), then secondary/tertiary fits. Display-only;
// the underlying lists, selection, and dirty tracking are untouched.
const posSort = ref('all')
const tablePlayers = computed(() => {
  const list = view.value === 'pool' ? freeAgents.value : activeRoster.value
  const pos = posSort.value
  if (pos === 'all') return list
  const rank = (p) => {
    if (p.position === pos) return 0
    const sec = p.secondaryPosition ?? p.secondary_position
    const ter = p.tertiaryPosition ?? p.tertiary_position
    return sec === pos || ter === pos ? 1 : 2
  }
  const ovrOf = (p) => p.overallRating ?? p.overall_rating ?? 0
  return list
    .filter((p) => rank(p) < 2)
    .sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      if (ra !== rb) return ra - rb
      return ovrOf(b) - ovrOf(a)
    })
})
// Team rosters honor the game-wide 15-man cap; the fantasy pool is uncapped.
const rosterFull = computed(() => view.value === 'roster' && activeRoster.value.length >= MAX_ROSTER_SIZE)

onMounted(async () => {
  // Returning mid-edit (e.g. from the headshot editor round-trip): the Pinia
  // store survives the navigation, so restore the screen the user left —
  // re-fetch the active list (headshot flags may have changed) and keep their
  // selection — instead of dumping them back on the team grid.
  const resuming = store.campaignId === campaignId.value && hasStarted.value
    && (store.activeTeamId || freeAgents.value.length)
  if (resuming) {
    const prevSelected = store.selectedId
    if (isDirty.value) {
      // Other rows have unsaved edits — don't clobber them with a refetch;
      // just refresh the row the headshot editor may have touched.
      view.value = store.activeTeamId ? 'roster' : 'pool'
      if (prevSelected) await store.refreshPlayerFromDb(prevSelected)
    } else if (store.activeTeamId) {
      await store.openTeam(store.activeTeamId)
      view.value = 'roster'
    } else {
      await store.openPool()
      view.value = 'pool'
    }
    if (prevSelected) store.selectedId = prevSelected
  } else {
    await store.load(campaignId.value)
  }
  ackConfirmed.value = localStorage.getItem(ACK_KEY) === '1'
  if (!hasStarted.value && !ackConfirmed.value) showAck.value = true
  // Community downloads power the "Start from Downloaded" card (standard
  // campaigns only — the importer doesn't support fantasy yet).
  if (!hasStarted.value && !isFantasy.value) fetchDownloadedBuilds()
})

function acceptAck() {
  localStorage.setItem(ACK_KEY, '1')
  ackConfirmed.value = true
  showAck.value = false
}

// --- Community (Part B) -----------------------------------------------------
// All sharing/browsing lives on the WEB build. Native: one-time login handoff
// URL opened in the system browser. Web: plain route (already logged in).
const downloadedBuilds = ref([])
const selectedBuildId = ref(null)
const importing = ref(false)

async function openCommunity() {
  const returnTo = `/community?campaign=${encodeURIComponent(campaignId.value)}`
  if (!Capacitor.isNativePlatform()) {
    router.push(returnTo)
    return
  }
  try {
    const res = await api.post('/api/auth/handoff', { return_to: returnTo })
    window.open(res.data.url, '_system')
  } catch { /* handoff mint failed — non-fatal, user can retry */ }
}

async function fetchDownloadedBuilds() {
  try {
    const res = await api.get('/api/roster-builds/downloads', { skipErrorToast: true })
    downloadedBuilds.value = res.data?.builds ?? []
    if (downloadedBuilds.value.length) selectedBuildId.value = downloadedBuilds.value[0].id
  } catch {
    downloadedBuilds.value = []
  }
}

async function pickDownloaded() {
  if (!selectedBuildId.value || importing.value) return
  importing.value = true
  try {
    const res = await api.get(`/api/roster-builds/${selectedBuildId.value}/blob`)
    await store.applyDownloadedBuild(res.data)
  } catch (err) {
    store.error = err?.message || 'Failed to apply the downloaded roster'
  } finally {
    importing.value = false
  }
}

async function pickStart(mode) {
  await store.chooseStart(mode)
  if (isFantasy.value) { await store.openPool(); view.value = 'pool' }
}

// --- Dirty-state guards -----------------------------------------------------
// Run `action` immediately when clean; otherwise open the Save/Discard prompt
// and run it after the choice.
function guardThen(action) {
  if (!isDirty.value) { action(); return }
  pendingGuardAction.value = action
}

async function guardSave() {
  const action = pendingGuardAction.value
  pendingGuardAction.value = null
  await store.saveDirty()
  action?.()
}

async function guardDiscard() {
  const action = pendingGuardAction.value
  pendingGuardAction.value = null
  await store.discardDirty()
  action?.()
}

onBeforeRouteLeave((to) => {
  if (!isDirty.value) return true
  guardThen(() => router.push(to.fullPath))
  return false
})

// --- Navigation -------------------------------------------------------------
async function openTeam(team) {
  guardThen(async () => {
    await store.openTeam(team.id)
    tableMode.value = 'current'
    view.value = 'roster'
  })
}

function openPool() {
  guardThen(async () => {
    await store.openPool()
    tableMode.value = 'current'
    view.value = 'pool'
  })
}

function backToTeams() {
  guardThen(() => {
    view.value = 'teams'
    store.activeTeamId = null
  })
}

// --- Player editing ---------------------------------------------------------
function onTableEdited(player) {
  store.markDirtyPlayer(player.id)
}

async function addTeamPlayer() {
  const p = await store.addPlayer()
  if (p) editingPlayer.value = p
}

async function addPoolPlayer() {
  const p = await store.addPoolPlayer()
  if (p) editingPlayer.value = p
}

function editPlayer(p) { editingPlayer.value = p }

// Row tap: first tap selects (chevrons + hero header); tapping the already
// selected row opens the full details modal.
function onRowSelect(p) {
  if (selectedId.value === p.id) {
    editPlayer(p)
    return
  }
  store.select(p)
}
function closePlayerEditor() { editingPlayer.value = null }

async function onPlayerSaved(p) {
  await store.savePlayer(p)
  editingPlayer.value = null
}

async function removePlayer(p) {
  await store.removePlayer(p, view.value === 'pool')
}

// Headshot handoff — persist first (nothing lost), capture the return route,
// then jump to the existing headshot editor.
async function editHeadshot(player) {
  await store.savePlayer(player)
  editingPlayer.value = null
  const returnStore = useHeadshotEditorReturnStore()
  returnStore.capture({ routeName: 'roster-setup', routeParams: { id: campaignId.value }, playerId: player.id })
  router.push({ name: 'headshot-editor', params: { id: campaignId.value, playerId: player.id } })
}

// --- Coach editing ----------------------------------------------------------
function editCoach(team) { editingCoachTeam.value = team }
function closeCoachEditor() { editingCoachTeam.value = null }

async function onCoachSaved(team) {
  await store.saveTeamCoach(team)
  editingCoachTeam.value = null
}

function coachName(team) {
  const c = team?.coach
  if (!c) return 'No coach'
  return c.name || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Coach'
}

// --- Payroll meter (display only) -------------------------------------------
const teamPayroll = computed(() =>
  activeRoster.value.reduce((sum, p) => sum + (Number(p.contractSalary ?? p.contract_salary) || 0), 0))
const payrollClass = computed(() => {
  if (teamPayroll.value >= LUXURY_TAX) return 'tax'
  if (teamPayroll.value >= SALARY_CAP) return 'over'
  return 'ok'
})
function fmtM(v) { return `$${(v / 1_000_000).toFixed(1)}M` }

// --- Finalize ---------------------------------------------------------------
async function openFinalize() {
  guardThen(async () => {
    validating.value = true
    try {
      finalizeProblems.value = await store.validate()
      showFinalize.value = true
    } finally {
      validating.value = false
    }
  })
}

async function confirmFinalize() {
  const id = campaignId.value
  const fantasy = isFantasy.value
  await store.finalize()
  showFinalize.value = false
  store.$reset()
  useCampaignStore().clearCurrentCampaign()
  if (fantasy) router.replace(`/campaign/${id}/draft`)
  else router.replace(`/campaign/${id}`)
}
</script>

<template>
  <div class="roster-setup">
    <!-- Sticky header bar -->
    <header class="rs-header">
      <div class="rs-header-left">
        <button v-if="view !== 'teams'" class="rs-back" @click="backToTeams">
          <ArrowLeft :size="18" /> Teams
        </button>
        <h1 class="rs-title">
          <TeamLogo
            v-if="view === 'roster' && activeTeam"
            :abbreviation="activeTeam.abbreviation"
            :color="activeTeam.primaryColor ?? activeTeam.primary_color ?? activeTeam.color"
            :size="24"
          />
          <ClipboardList v-else :size="20" />
          {{ view === 'roster' && activeTeam
            ? (activeTeam.name ?? activeTeam.abbreviation)
            : view === 'pool' ? 'Draft Pool' : 'Roster Editor' }}
        </h1>
        <span v-if="view === 'roster' && !isFantasy" class="rs-payroll" :class="payrollClass">
          {{ fmtM(teamPayroll) }} <em>/ cap {{ fmtM(SALARY_CAP) }}</em>
        </span>
      </div>
      <div class="rs-header-actions">
        <button class="rs-community-btn" title="Community roster board (web)" @click="openCommunity">
          <Globe :size="15" /> Community
        </button>
        <button v-if="isDirty" class="rs-save-btn" :disabled="saving" @click="store.saveDirty()">
          <Loader2 v-if="saving" :size="15" class="spin" />
          <Save v-else :size="15" />
          Save Changes ({{ dirtyIds.size }})
        </button>
        <button
          v-if="hasStarted"
          class="rs-finalize-btn"
          :disabled="validating || saving"
          @click="openFinalize"
        >
          <Loader2 v-if="validating" :size="16" class="spin" />
          <ShieldCheck v-else :size="16" />
          Finish &amp; Start Season
        </button>
      </div>
    </header>

    <div v-if="loading" class="rs-loading"><Loader2 :size="28" class="spin" /> Loading league…</div>
    <div v-else-if="error" class="rs-error">{{ error }}</div>

    <!-- Start choice -->
    <section v-else-if="!hasStarted" class="rs-start">
      <h2>How do you want to build your league?</h2>
      <p class="rs-sub">You can tweak everything either way — this just sets your starting point.</p>
      <div class="rs-start-grid">
        <button class="rs-start-card" @click="pickStart('generated')">
          <Users :size="28" />
          <span class="rs-start-name">Start from Generated</span>
          <span class="rs-start-desc">A full, balanced league is already built. Adjust any player or coach you like.</span>
        </button>
        <button class="rs-start-card" @click="pickStart('scratch')">
          <ClipboardList :size="28" />
          <span class="rs-start-name">Start from Scratch</span>
          <span class="rs-start-desc">Every roster is emptied. Build each team yourself before the season can start.</span>
        </button>
        <div v-if="downloadedBuilds.length" class="rs-start-card rs-start-downloaded">
          <Download :size="28" />
          <span class="rs-start-name">Start from Downloaded</span>
          <span class="rs-start-desc">Use a community roster you saved on the web.</span>
          <select v-model="selectedBuildId" class="rs-build-select" @click.stop>
            <option v-for="b in downloadedBuilds" :key="b.id" :value="b.id">
              {{ b.title }}{{ b.author ? ` — ${b.author}` : '' }}
            </option>
          </select>
          <button class="rs-modal-primary" :disabled="importing" @click.stop="pickDownloaded">
            <Loader2 v-if="importing" :size="15" class="spin" />
            Use This Roster
          </button>
        </div>
      </div>
      <p class="rs-note" style="text-align: center;">
        Looking for community rosters?
        <button class="rs-link" @click="openCommunity">Browse the Community board →</button>
      </p>
    </section>

    <!-- Team grid -->
    <section v-else-if="view === 'teams'" class="rs-teams">
      <div class="rs-team-grid">
        <button
          v-for="team in teams"
          :key="team.id"
          class="rs-team-card"
          :class="{ 'is-user': team.id === userTeamId }"
          @click="openTeam(team)"
        >
          <span class="rs-team-head">
            <TeamLogo
              :abbreviation="team.abbreviation"
              :color="team.primaryColor ?? team.primary_color ?? team.color"
              :size="28"
            />
            <span class="rs-team-abbr">{{ team.abbreviation }}</span>
          </span>
          <span class="rs-team-name">{{ team.name }}</span>
          <span class="rs-team-coach">HC: {{ coachName(team) }}</span>
          <span v-if="team.id === userTeamId" class="rs-team-tag">Your team</span>
        </button>
      </div>
      <p v-if="isFantasy" class="rs-note">
        Fantasy draft: edit the draftable player pool, then finish to start the draft.
        <button class="rs-link" @click="openPool">Edit draft pool →</button>
      </p>
    </section>

    <!-- Roster / pool editor -->
    <section v-else class="rs-editor">
      <p v-if="view === 'roster' && isFantasy" class="rs-note">
        Fantasy draft: team rosters are filled during the draft. Edit this team's coach below,
        and build the draftable players in the pool.
      </p>

      <template v-if="view === 'pool' || !isFantasy">
        <SelectedPlayerHeader
          :player="selectedPlayer"
          :campaign-id="campaignId"
          :can-edit-headshot="hasHeadshotEditor"
          @edit="editPlayer"
          @edit-headshot="editHeadshot"
          @edited="onTableEdited"
        />

        <div class="rs-toolbar">
          <div class="rs-mode-toggle">
            <button
              class="rs-mode"
              :class="{ active: tableMode === 'current' }"
              @click="tableMode = 'current'"
            >Current</button>
            <button
              class="rs-mode ceiling"
              :class="{ active: tableMode === 'ceiling' }"
              @click="tableMode = 'ceiling'"
            >Ceilings</button>
          </div>
          <PositionFilterBar v-model="posSort" />
          <span class="rs-toolbar-hint">
            {{ tableMode === 'ceiling'
              ? 'Editing growth ceilings — the max each attribute can develop to.'
              : 'Tap a row to select it, then use the chevrons to adjust attributes.' }}
          </span>
        </div>

        <RosterAttributeTable
          :players="tablePlayers"
          :selected-id="selectedId"
          :mode="tableMode"
          @select="onRowSelect"
          @edited="onTableEdited"
          @remove="removePlayer"
        />

        <button v-if="!rosterFull" class="rs-add-btn" @click="view === 'pool' ? addPoolPlayer() : addTeamPlayer()">
          <Plus :size="16" /> Add Player
          <em v-if="view === 'roster'" class="rs-add-count">({{ activeRoster.length }}/{{ MAX_ROSTER_SIZE }})</em>
        </button>
        <p v-else class="rs-roster-full">Roster full ({{ MAX_ROSTER_SIZE }}/{{ MAX_ROSTER_SIZE }}) — remove a player to add another.</p>
      </template>

      <div v-if="view === 'roster'" class="rs-coach-row">
        <div>
          <span class="rs-coach-label">Head Coach</span>
          <span class="rs-coach-name">{{ coachName(activeTeam) }}</span>
        </div>
        <button class="rs-edit-btn" @click="editCoach(activeTeam)">Edit Coach</button>
      </div>
    </section>

    <!-- Acknowledgement gate -->
    <div v-if="showAck" class="rs-modal-overlay">
      <div class="rs-modal">
        <h3><AlertTriangle :size="18" /> Before you build</h3>
        <p>
          Custom rosters are for your own private league. Please don't recreate real
          players, teams, or logos by name or likeness — keep names and content
          original. Your builds are saved to your account only.
        </p>
        <button class="rs-modal-primary" @click="acceptAck">I understand</button>
      </div>
    </div>

    <!-- Unsaved-changes guard -->
    <div v-if="pendingGuardAction" class="rs-modal-overlay">
      <div class="rs-modal">
        <h3><AlertTriangle :size="18" /> Unsaved changes</h3>
        <p>You have {{ dirtyIds.size }} player{{ dirtyIds.size === 1 ? '' : 's' }} with unsaved edits.</p>
        <div class="rs-modal-actions">
          <button class="rs-modal-secondary" @click="guardDiscard">Discard</button>
          <button class="rs-modal-primary" :disabled="saving" @click="guardSave">
            <Loader2 v-if="saving" :size="16" class="spin" /> Save
          </button>
        </div>
      </div>
    </div>

    <!-- Finalize confirm -->
    <div v-if="showFinalize" class="rs-modal-overlay">
      <div class="rs-modal">
        <template v-if="finalizeProblems.length">
          <h3><AlertTriangle :size="18" /> Not ready yet</h3>
          <ul class="rs-problems">
            <li v-for="(prob, i) in finalizeProblems" :key="i">{{ prob }}</li>
          </ul>
          <button class="rs-modal-secondary" @click="showFinalize = false">Keep editing</button>
        </template>
        <template v-else>
          <h3><Check :size="18" /> Start the season?</h3>
          <p>
            This locks in your custom league and starts the campaign. You can still
            develop players afterward through normal gameplay.
          </p>
          <div class="rs-modal-actions">
            <button class="rs-modal-secondary" @click="showFinalize = false">Not yet</button>
            <button class="rs-modal-primary" :disabled="saving" @click="confirmFinalize">
              <Loader2 v-if="saving" :size="16" class="spin" /> Start Season
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- Player details editor -->
    <PlayerDetailsEditorModal
      v-if="editingPlayer"
      :player="editingPlayer"
      :campaign-id="campaignId"
      :can-edit-headshot="hasHeadshotEditor"
      @save="onPlayerSaved"
      @close="closePlayerEditor"
      @edit-headshot="editHeadshot"
    />

    <!-- Coach editor -->
    <CoachEditor
      v-if="editingCoachTeam"
      :team="editingCoachTeam"
      :campaign-id="campaignId"
      :can-edit-headshot="hasHeadshotEditor"
      @save="onCoachSaved"
      @close="closeCoachEditor"
    />
  </div>
</template>

<style scoped>
/* Transparent root: the global body stars/scanlines show through, matching
   every other standard view. */
.roster-setup {
  min-height: 100vh;
  color: var(--color-text-primary);
  padding: 0 0 80px;
}

.rs-header {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 18px;
  background: var(--glass-bg);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--glass-border);
}

.rs-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.rs-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.rs-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.35rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  margin: 0;
  white-space: nowrap;
}

.rs-payroll {
  font-size: 0.72rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.rs-payroll em {
  font-style: normal;
  font-weight: 600;
  color: var(--color-text-tertiary);
}

.rs-payroll.ok { color: var(--color-success); }
.rs-payroll.over { color: var(--color-warning); }
.rs-payroll.tax { color: var(--color-error); }

.rs-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--color-primary);
  font-weight: 600;
  cursor: pointer;
  padding: 4px 6px;
}

.rs-community-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--glass-bg);
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  padding: 9px 14px;
  font-weight: 700;
  cursor: pointer;
}

.rs-community-btn:hover {
  border-color: var(--color-primary);
}

.rs-build-select {
  width: 100%;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  font-size: 0.85rem;
}

.rs-start-downloaded {
  cursor: default;
}

.rs-save-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 9px 14px;
  font-weight: 700;
  cursor: pointer;
}

.rs-save-btn:disabled { opacity: 0.6; }

.rs-finalize-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--color-success);
  color: #06210f;
  border: none;
  border-radius: 10px;
  padding: 9px 14px;
  font-weight: 700;
  cursor: pointer;
}

.rs-finalize-btn:disabled { opacity: 0.6; cursor: default; }

.rs-loading, .rs-error { text-align: center; padding: 64px 16px; color: var(--color-text-secondary); }
.rs-error { color: var(--color-error); }

.rs-start { max-width: 760px; margin: 0 auto; padding: 40px 18px; text-align: center; }
.rs-start h2 { margin: 0 0 6px; }
.rs-sub { color: var(--color-text-secondary); margin: 0 0 24px; }
.rs-start-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
@media (max-width: 640px) { .rs-start-grid { grid-template-columns: 1fr; } }

.rs-start-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 20px;
  border-radius: var(--radius-xl, 16px);
  cursor: pointer;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: inherit;
  text-align: center;
}

.rs-start-card:hover { border-color: var(--color-primary); background: rgba(232, 90, 79, 0.08); }
.rs-start-name { font-weight: 700; font-size: 1.05rem; }
.rs-start-desc { color: var(--color-text-secondary); font-size: 0.85rem; }

.rs-teams { padding: 18px; max-width: 1024px; margin: 0 auto; }
.rs-team-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }

.rs-team-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 14px;
  border-radius: var(--radius-lg, 12px);
  cursor: pointer;
  position: relative;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: inherit;
  text-align: left;
}

.rs-team-card:hover { border-color: var(--color-primary); }
.rs-team-card.is-user { border-color: var(--color-primary); background: rgba(232, 90, 79, 0.08); }
.rs-team-head { display: flex; align-items: center; gap: 8px; }
.rs-team-abbr { font-weight: 800; font-size: 1.1rem; }
.rs-team-name { font-size: 0.85rem; color: var(--color-text-secondary); }
.rs-team-coach { font-size: 0.72rem; color: var(--color-text-tertiary); }

.rs-team-tag {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 0.62rem;
  background: var(--color-primary);
  color: #fff;
  border-radius: 6px;
  padding: 2px 6px;
}

.rs-note { margin: 14px 0 0; color: var(--color-text-secondary); font-size: 0.85rem; }
.rs-link { background: none; border: none; color: var(--color-primary); cursor: pointer; font-weight: 600; }

.rs-editor { padding: 14px 14px 0; max-width: 1100px; margin: 0 auto; }

.rs-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.rs-mode-toggle {
  display: inline-flex;
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  overflow: hidden;
}

.rs-mode {
  padding: 7px 16px;
  border: none;
  background: var(--glass-bg);
  color: var(--color-text-secondary);
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.rs-mode.active { background: var(--color-primary); color: #fff; }
.rs-mode.ceiling.active { background: var(--color-success); color: #06210f; }

.rs-toolbar-hint { font-size: 0.72rem; color: var(--color-text-tertiary); }

.rs-coach-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: var(--radius-lg, 12px);
  margin-top: 16px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.rs-coach-label { display: block; font-size: 0.7rem; color: var(--color-text-tertiary); text-transform: uppercase; }
.rs-coach-name { font-weight: 700; }

.rs-edit-btn {
  background: rgba(232, 90, 79, 0.14);
  color: var(--color-primary);
  border: 1px solid rgba(232, 90, 79, 0.3);
  border-radius: 8px;
  padding: 6px 12px;
  font-weight: 600;
  cursor: pointer;
}

.rs-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  background: rgba(232, 90, 79, 0.12);
  color: var(--color-primary);
  border: 1px dashed rgba(232, 90, 79, 0.4);
  border-radius: 10px;
  padding: 10px 16px;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
  justify-content: center;
}

.rs-add-count {
  font-style: normal;
  font-weight: 600;
  opacity: 0.7;
  font-size: 0.82em;
}

.rs-roster-full {
  margin: 12px 0 0;
  padding: 10px 16px;
  text-align: center;
  font-size: 0.82rem;
  color: var(--color-text-tertiary);
  border: 1px dashed var(--glass-border);
  border-radius: 10px;
}

.rs-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: 20px;
}

.rs-modal {
  width: 100%;
  max-width: 420px;
  border-radius: var(--radius-xl, 16px);
  padding: 22px;
  background: var(--glass-bg-elevated, var(--color-bg-secondary));
  border: 1px solid var(--glass-border);
}

.rs-modal h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; }
.rs-modal p { color: var(--color-text-secondary); font-size: 0.9rem; line-height: 1.5; margin: 0 0 18px; }
.rs-problems { margin: 0 0 18px; padding-left: 18px; font-size: 0.85rem; color: var(--color-text-secondary); }
.rs-problems li { margin-bottom: 4px; }
.rs-modal-actions { display: flex; gap: 10px; justify-content: flex-end; }

.rs-modal-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 10px 16px;
  font-weight: 700;
  cursor: pointer;
}

.rs-modal-primary:disabled { opacity: 0.6; }

.rs-modal-secondary {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  padding: 10px 16px;
  font-weight: 600;
  cursor: pointer;
}

.spin { animation: rs-spin 1s linear infinite; }
@keyframes rs-spin { to { transform: rotate(360deg); } }
</style>
