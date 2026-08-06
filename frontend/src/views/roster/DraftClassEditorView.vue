<script setup>
// Rookie Class editor (custom_roster IAP) — flat-pool sibling of the roster
// editor. Two entry contexts:
//   • In-campaign "Generate & Edit": reachable ONLY while the season-start
//     rookie-class window is open (settings.rookieClassSetupPending) — the
//     onMounted guard bounces any other visit, so prospect ratings can't be
//     retuned mid-season after scouting has spent points.
//   • Builder draft-class workshops (settings.workshopMode === 'draft_class'):
//     always editable, back goes to /builder, finishing never stamps campaign
//     season flags.
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { storeToRefs } from 'pinia'
import {
  Loader2, ArrowLeft, AlertTriangle, Check, Plus, Save, Sparkles, RefreshCw,
  ClipboardList, Download,
} from 'lucide-vue-next'
import api from '@/composables/useApi'
import { fetchBuildBlob } from '@/composables/useBuildBlob'
import { useCommunityLink } from '@/composables/useCommunityLink'
import { listDraftClassWorkshopSources, buildWorkshopClassBlob } from '@/engine/campaign/WorkshopService'
import { useDraftClassEditorStore, MIN_CLASS_SIZE, MAX_CLASS_SIZE } from '@/stores/draftClassEditor'
import { useAuthStore } from '@/stores/auth'
import { useAudioStore } from '@/stores/audio'
import { useToastStore } from '@/stores/toast'
import { useHeadshotEditorReturnStore } from '@/stores/headshotEditorReturn'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import RosterAttributeTable from '@/components/roster/RosterAttributeTable.vue'
import SelectedPlayerHeader from '@/components/roster/SelectedPlayerHeader.vue'
import PlayerDetailsEditorModal from '@/components/roster/PlayerDetailsEditorModal.vue'
import PositionFilterBar from '@/components/trade/PositionFilterBar.vue'

const route = useRoute()
const router = useRouter()
const store = useDraftClassEditorStore()
const authStore = useAuthStore()
const {
  prospects, targetDraftYear, isWorkshop, hasStarted, loading, saving, error,
  selectedId, selectedPlayer, isDirty, dirtyIds,
} = storeToRefs(store)

const campaignId = computed(() => route.params.id)
const hasHeadshotEditor = computed(() => authStore.hasFeature('headshot_editor'))

const tableMode = ref('current') // 'current' | 'ceiling'
const posSort = ref('all')
const editingPlayer = ref(null)
const showAddProspect = ref(false)
const addTier = ref('secondRound')
const addingProspect = ref(false)
const showRegenerate = ref(false)
const regenerating = ref(false)
const showFinish = ref(false)
const finishProblems = ref([])
const filling = ref(false)
const pendingRemovePlayer = ref(null)
const pendingGuardAction = ref(null)

// Workshop start chooser (generated / scratch / imported) — shown until the
// project's first-start choice is made (mirrors RosterSetupView's rs-start).
const downloadedBuilds = ref([])
const builderSources = ref([])
const selectedSourceId = ref(null)
const startBusy = ref(false)
const showStartChooser = computed(() => isWorkshop.value && !hasStarted.value)

// Import sources: other Builder projects first (no publish needed), then
// downloaded community classes.
const importSources = computed(() => [
  ...builderSources.value.map((w) => ({
    id: `workshop:${w.workshopId}`,
    _workshopId: w.workshopId,
    title: w.title,
    prospectCount: w.prospectCount,
  })),
  ...downloadedBuilds.value,
])

const ADD_TIERS = [
  { key: 'franchise', label: 'Franchise' },
  { key: 'lottery', label: 'Lottery' },
  { key: 'firstRound', label: '1st Round' },
  { key: 'secondRound', label: '2nd Round' },
  { key: 'undrafted', label: 'Undrafted-grade' },
]

onMounted(async () => {
  await store.load(campaignId.value)
  // Access window: outside a workshop, this editor exists only inside the
  // season-start setup flow. Any other visit (deep link, stale history entry,
  // mid-season poke) bounces home.
  if (!isWorkshop.value) {
    const s = store.campaign?.settings ?? {}
    const windowOpen = s.rookieClassSetupPending === true
      && store.campaign?.phase === 'regular_season'
    if (!windowOpen) {
      router.replace(`/campaign/${campaignId.value}`)
      return
    }
  }
  if (showStartChooser.value) fetchDownloadedBuilds()
  // Headshot-editor round trip: land back on the prospect that was being
  // edited (same pattern as RosterSetupView).
  const returnStore = useHeadshotEditorReturnStore()
  const { route: ret, playerId } = returnStore.peek()
  if (ret?.name === 'rookie-class' && playerId) {
    returnStore.consume()
    const p = prospects.value.find((x) => x.id === playerId)
    if (p) {
      store.select(p)
      editingPlayer.value = p
    }
  }
})

const tablePlayers = computed(() => {
  const list = prospects.value
  const pos = posSort.value
  if (pos === 'all') return list
  const rank = (p) => {
    if (p.position === pos) return 0
    const sec = p.secondaryPosition ?? p.secondary_position
    return sec === pos ? 1 : 2
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

// --- Save feedback (mirrors RosterSetupView) ---------------------------------
async function saveWithFeedback(op, successMsg) {
  const audio = useAudioStore()
  const toast = useToastStore()
  audio.suppressClickSound()
  try {
    await op()
    audio.affirm()
    toast.showSuccess(successMsg)
    return true
  } catch (err) {
    audio.cancel()
    toast.showError(err?.message || 'Save failed — please try again')
    return false
  }
}

function saveDirtyWithFeedback() {
  const n = dirtyIds.value.size
  return saveWithFeedback(() => store.saveDirty(), `Saved ${n} prospect${n === 1 ? '' : 's'}`)
}

// --- Dirty guards ------------------------------------------------------------
function guardThen(action) {
  if (!isDirty.value) { action(); return }
  pendingGuardAction.value = action
}

async function guardSave() {
  const action = pendingGuardAction.value
  pendingGuardAction.value = null
  const ok = await saveDirtyWithFeedback()
  if (ok) action?.()
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

function goBack() {
  guardThen(() => {
    router.push(isWorkshop.value ? '/builder' : `/campaign/${campaignId.value}`)
  })
}

// --- Row / player editing ----------------------------------------------------
function onTableEdited(player) {
  store.markDirtyPlayer(player.id)
}

function onRowSelect(p) {
  useAudioStore().navigate()
  if (selectedId.value === p.id) {
    editingPlayer.value = p
    return
  }
  store.select(p)
}

async function onPlayerSaved(p) {
  const ok = await saveWithFeedback(() => store.savePlayer(p), 'Prospect saved')
  if (ok) editingPlayer.value = null
}

function removePlayer(p) {
  useAudioStore().navigate()
  pendingRemovePlayer.value = p
}

async function confirmRemovePlayer() {
  const p = pendingRemovePlayer.value
  pendingRemovePlayer.value = null
  if (p) await store.removeProspect(p)
}

async function editHeadshot(player) {
  if (!hasHeadshotEditor.value) return
  await store.savePlayer(player)
  editingPlayer.value = null
  const returnStore = useHeadshotEditorReturnStore()
  returnStore.capture({ routeName: 'rookie-class', routeParams: { id: campaignId.value }, playerId: player.id })
  router.push({ name: 'headshot-editor', params: { id: campaignId.value, playerId: player.id } })
}

// --- Workshop start chooser --------------------------------------------------
const { openCommunity: openCommunityLink } = useCommunityLink()
function openCommunity() {
  // Workshop round trips return to /builder (reopening the project re-offers
  // the chooser with the fresh download in the Imports list).
  return openCommunityLink(campaignId.value, { type: 'draft_class', back: 'builder' })
}

async function fetchDownloadedBuilds() {
  try {
    // A fresh unstarted project can't import itself — exclude it.
    builderSources.value = await listDraftClassWorkshopSources({
      excludeCampaignId: campaignId.value,
    })
  } catch {
    builderSources.value = []
  }
  try {
    const res = await api.get('/api/roster-builds/downloads', {
      params: { type: 'draft_class' },
      skipErrorToast: true,
    })
    downloadedBuilds.value = res.data?.builds ?? []
  } catch {
    downloadedBuilds.value = []
  }
  if (importSources.value.length) selectedSourceId.value = importSources.value[0].id
}

async function pickStart(mode) {
  if (startBusy.value) return
  startBusy.value = true
  const audio = useAudioStore()
  const toast = useToastStore()
  audio.suppressClickSound()
  try {
    await store.chooseStart(mode)
    audio.affirm()
    if (mode === 'generated') {
      toast.showSuccess(`Generated a fresh ${targetDraftYear.value} class`)
    }
  } catch (err) {
    audio.cancel()
    toast.showError(err?.message || 'Could not start the class — please try again')
  } finally {
    startBusy.value = false
  }
}

async function pickDownloaded() {
  if (!selectedSourceId.value || startBusy.value) return
  startBusy.value = true
  const audio = useAudioStore()
  const toast = useToastStore()
  audio.suppressClickSound()
  try {
    const picked = importSources.value.find((b) => b.id === selectedSourceId.value)
    if (!picked) return
    const blob = picked._workshopId
      ? await buildWorkshopClassBlob(picked._workshopId)
      : await fetchBuildBlob(picked.id)
    await store.applyImportedClass(blob)
    await store.chooseStart('downloaded')
    // showAchievement plays the affirmation sound itself.
    toast.showAchievement({
      header: 'Class Applied',
      label: picked?.title ?? 'Imported Class',
      subtitle: 'Tweak any prospect you like — it saves to this Builder project.',
    })
  } catch (err) {
    audio.cancel()
    toast.showError(err?.message || 'Failed to apply the imported class')
  } finally {
    startBusy.value = false
  }
}

// --- Add / regenerate --------------------------------------------------------
async function confirmAddProspect() {
  if (addingProspect.value) return
  addingProspect.value = true
  try {
    const p = await store.addProspect({ tier: addTier.value })
    if (p) {
      showAddProspect.value = false
      editingPlayer.value = p
    }
  } finally {
    addingProspect.value = false
  }
}

async function confirmRegenerate() {
  if (regenerating.value) return
  regenerating.value = true
  const audio = useAudioStore()
  const toast = useToastStore()
  audio.suppressClickSound()
  try {
    await store.regenerate()
    showRegenerate.value = false
    audio.affirm()
    toast.showSuccess('Rolled a fresh class')
  } catch (err) {
    audio.cancel()
    toast.showError(err?.message || 'Regeneration failed — please try again')
  } finally {
    regenerating.value = false
  }
}

async function fillRemaining() {
  if (filling.value) return
  filling.value = true
  const audio = useAudioStore()
  const toast = useToastStore()
  audio.suppressClickSound()
  try {
    const n = await store.fillToMinimum()
    audio.affirm()
    toast.showSuccess(`Generated ${n} prospect${n === 1 ? '' : 's'}`)
    finishProblems.value = store.validate()
  } catch (err) {
    audio.cancel()
    toast.showError(err?.message || 'Generation failed — please try again')
  } finally {
    filling.value = false
  }
}

// --- Finish ------------------------------------------------------------------
async function openFinish() {
  if (isDirty.value) {
    const ok = await saveDirtyWithFeedback()
    if (!ok) return
  }
  finishProblems.value = store.validate()
  showFinish.value = true
}

async function acceptFinish() {
  const audio = useAudioStore()
  audio.suppressClickSound()
  audio.affirm()
  showFinish.value = false
  if (!isWorkshop.value) {
    // Resolve the season-start setup window — the campaign-home modal chain
    // reads these stamps (pending flag cleared = editor unreachable again).
    const year = store.campaign?.currentSeasonYear ?? store.campaign?.current_season_year ?? null
    try {
      await CampaignRepository.updateSettings(campaignId.value, {
        rookieClassSetupPending: false,
        rookieClassSetupShownYear: year,
      })
    } catch (err) {
      console.warn('[RookieClassEditor] failed to resolve setup window:', err)
    }
  }
  router.replace(isWorkshop.value ? '/builder' : `/campaign/${campaignId.value}`)
}
</script>

<template>
  <div class="dce">
    <!-- Sticky header bar -->
    <header class="dce-header">
      <div class="dce-header-left">
        <button class="dce-back" @click="goBack">
          <ArrowLeft :size="18" /> {{ isWorkshop ? 'Builder' : 'Campaign' }}
        </button>
        <h1 class="dce-title">Rookie Class <span v-if="targetDraftYear">{{ targetDraftYear }}</span></h1>
      </div>
      <div v-if="!showStartChooser" class="dce-header-actions">
        <button v-if="isDirty" class="dce-save-btn" :disabled="saving" @click="saveDirtyWithFeedback">
          <Loader2 v-if="saving" :size="15" class="spin" />
          <Save v-else :size="15" />
          Save Changes ({{ dirtyIds.size }})
        </button>
        <button class="dce-finish-btn" :disabled="saving" @click="openFinish">
          <Check :size="16" />
          {{ isWorkshop ? 'Done' : 'Use This Class' }}
        </button>
      </div>
    </header>

    <div v-if="loading" class="dce-loading"><Loader2 :size="28" class="spin" /> Loading class…</div>
    <div v-else-if="error" class="dce-error">{{ error }}</div>

    <!-- Start choice (workshop only, until the first-start mode is picked) -->
    <section v-else-if="showStartChooser" class="dce-start">
      <h2>How do you want to build your class?</h2>
      <p class="dce-start-sub">You can tweak every prospect either way — this just sets your starting point.</p>
      <div class="dce-start-grid">
        <button class="dce-start-card" :disabled="startBusy" @click="pickStart('generated')">
          <Loader2 v-if="startBusy" :size="28" class="spin" />
          <Sparkles v-else :size="28" />
          <span class="dce-start-name">Start from Generated</span>
          <span class="dce-start-desc">A full {{ targetDraftYear }} class is rolled for you. Adjust any prospect you like.</span>
        </button>
        <button class="dce-start-card" :disabled="startBusy" @click="pickStart('scratch')">
          <ClipboardList :size="28" />
          <span class="dce-start-name">Start from Scratch</span>
          <span class="dce-start-desc">An empty class. Add every prospect yourself — it needs {{ MIN_CLASS_SIZE }} to publish.</span>
        </button>
        <div v-if="importSources.length" class="dce-start-card dce-start-downloaded">
          <Download :size="28" />
          <span class="dce-start-name">Imports</span>
          <span class="dce-start-desc">Start from another Builder project or a class imported from the Community board — tweak anything after.</span>
          <select v-model="selectedSourceId" class="dce-build-select" @click.stop>
            <option v-for="b in importSources" :key="b.id" :value="b.id">
              {{ b.title }}{{ b._workshopId ? ` — Builder project (${b.prospectCount})` : (b.author ? ` — ${b.author}` : '') }}
            </option>
          </select>
          <button class="dce-modal-primary" :disabled="startBusy" @click.stop="pickDownloaded">
            <Loader2 v-if="startBusy" :size="15" class="spin" />
            Use This Class
          </button>
        </div>
      </div>
      <p class="dce-start-note">
        Looking for community classes?
        <button class="dce-link" @click="openCommunity">Browse the Community board →</button>
      </p>
    </section>

    <section v-else class="dce-body">
      <SelectedPlayerHeader
        v-if="selectedPlayer"
        :player="selectedPlayer"
        :campaign-id="campaignId"
        :can-edit-headshot="hasHeadshotEditor"
        @edit="editingPlayer = selectedPlayer"
        @edit-headshot="editHeadshot"
        @edited="onTableEdited"
        @deselect="store.selectedId = null"
      />
      <div v-else class="dce-summary">
        <div class="dce-count" :class="{ short: prospects.length < MIN_CLASS_SIZE }">
          {{ prospects.length }} prospects
          <em>(draft needs {{ MIN_CLASS_SIZE }}, max {{ MAX_CLASS_SIZE }})</em>
        </div>
        <button class="dce-regen-btn" :disabled="regenerating" @click="showRegenerate = true">
          <RefreshCw :size="14" /> Reroll Class
        </button>
      </div>

      <div class="dce-toolbar">
        <div class="dce-mode-toggle">
          <button class="dce-mode" :class="{ active: tableMode === 'current' }" @click="tableMode = 'current'">Overall</button>
          <button class="dce-mode ceiling" :class="{ active: tableMode === 'ceiling' }" @click="tableMode = 'ceiling'">Potential</button>
        </div>
        <PositionFilterBar v-model="posSort" />
        <span class="dce-toolbar-hint">
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
        @deselect="store.selectedId = null"
      />

      <div class="dce-add-row">
        <button class="dce-add-btn" @click="showAddProspect = true">
          <Plus :size="16" /> Add Prospect
          <em class="dce-add-count">({{ prospects.length }}/{{ MAX_CLASS_SIZE }})</em>
        </button>
        <button
          v-if="prospects.length < MIN_CLASS_SIZE"
          class="dce-add-btn dce-generate-btn"
          :disabled="filling"
          @click="fillRemaining"
        >
          <Loader2 v-if="filling" :size="16" class="spin" />
          <Sparkles v-else :size="16" />
          Generate remaining ({{ MIN_CLASS_SIZE - prospects.length }})
        </button>
      </div>
    </section>

    <!-- Remove confirm -->
    <div v-if="pendingRemovePlayer" class="dce-modal-overlay">
      <div class="dce-modal">
        <h3><AlertTriangle :size="18" /> Remove prospect</h3>
        <p>
          Remove
          <strong>{{ pendingRemovePlayer.name ?? ((pendingRemovePlayer.firstName ?? '') + ' ' + (pendingRemovePlayer.lastName ?? '')) }}</strong>
          from the class? This can't be undone.
        </p>
        <div class="dce-modal-actions">
          <button class="dce-modal-secondary" @click="pendingRemovePlayer = null">Cancel</button>
          <button class="dce-modal-primary" @click="confirmRemovePlayer">Remove</button>
        </div>
      </div>
    </div>

    <!-- Regenerate confirm -->
    <div v-if="showRegenerate" class="dce-modal-overlay">
      <div class="dce-modal">
        <h3><AlertTriangle :size="18" /> Reroll the class?</h3>
        <p>
          This replaces every prospect (including your edits) with a freshly
          generated {{ targetDraftYear }} class. This can't be undone.
        </p>
        <div class="dce-modal-actions">
          <button class="dce-modal-secondary" @click="showRegenerate = false">Cancel</button>
          <button class="dce-modal-primary" :disabled="regenerating" @click="confirmRegenerate">
            <Loader2 v-if="regenerating" :size="16" class="spin" /> Reroll
          </button>
        </div>
      </div>
    </div>

    <!-- Unsaved-changes guard -->
    <div v-if="pendingGuardAction" class="dce-modal-overlay">
      <div class="dce-modal">
        <h3><AlertTriangle :size="18" /> Unsaved changes</h3>
        <p>You have {{ dirtyIds.size }} prospect{{ dirtyIds.size === 1 ? '' : 's' }} with unsaved edits.</p>
        <div class="dce-modal-actions">
          <button class="dce-modal-secondary" @click="guardDiscard">Discard</button>
          <button class="dce-modal-primary" :disabled="saving" @click="guardSave">
            <Loader2 v-if="saving" :size="16" class="spin" /> Save
          </button>
        </div>
      </div>
    </div>

    <!-- Add prospect -->
    <div v-if="showAddProspect" class="dce-modal-overlay">
      <div class="dce-modal">
        <h3><Plus :size="18" /> New Prospect</h3>
        <label class="dce-add-field">
          <span>Prospect tier</span>
          <select v-model="addTier" class="dce-add-select">
            <option v-for="t in ADD_TIERS" :key="t.key" :value="t.key">{{ t.label }}</option>
          </select>
        </label>
        <p class="dce-note">
          Generates a prospect in the tier's rating band — then tweak everything.
        </p>
        <div class="dce-modal-actions">
          <button class="dce-modal-secondary" @click="showAddProspect = false">Cancel</button>
          <button class="dce-modal-primary" :disabled="addingProspect" @click="confirmAddProspect">
            <Loader2 v-if="addingProspect" :size="16" class="spin" />
            Create Prospect
          </button>
        </div>
      </div>
    </div>

    <!-- Finish confirm -->
    <div v-if="showFinish" class="dce-modal-overlay">
      <div class="dce-modal">
        <template v-if="finishProblems.length">
          <h3><AlertTriangle :size="18" /> Not ready yet</h3>
          <ul class="dce-problems">
            <li v-for="(prob, i) in finishProblems" :key="i">{{ prob }}</li>
          </ul>
          <div class="dce-modal-actions">
            <button class="dce-modal-secondary" @click="showFinish = false">Keep editing</button>
            <button
              v-if="prospects.length < MIN_CLASS_SIZE"
              class="dce-modal-primary"
              :disabled="filling"
              @click="fillRemaining"
            >
              <Loader2 v-if="filling" :size="16" class="spin" />
              <Sparkles v-else :size="16" />
              Generate the rest
            </button>
          </div>
        </template>
        <template v-else>
          <h3><Check :size="18" /> {{ isWorkshop ? 'Done editing?' : 'Use this class?' }}</h3>
          <p v-if="isWorkshop">
            Your class is saved to this Builder project — come back and keep
            tweaking anytime, or publish it from the Community board.
          </p>
          <p v-else>
            This locks in the {{ targetDraftYear }} class for this season's
            scouting board and draft.
          </p>
          <div class="dce-modal-actions">
            <button class="dce-modal-secondary" @click="showFinish = false">Not yet</button>
            <button class="dce-modal-primary" :disabled="saving" @click="acceptFinish">
              <Loader2 v-if="saving" :size="16" class="spin" />
              {{ isWorkshop ? 'Done' : 'Lock It In' }}
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- Prospect details editor -->
    <PlayerDetailsEditorModal
      v-if="editingPlayer"
      :player="editingPlayer"
      :campaign-id="campaignId"
      :prospect="true"
      :can-edit-headshot="hasHeadshotEditor"
      @save="onPlayerSaved"
      @close="editingPlayer = null"
      @edit-headshot="editHeadshot"
    />
  </div>
</template>

<style scoped>
.dce {
  min-height: 100vh;
  padding-bottom: 60px;
}

.dce-header {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: calc(var(--safe-area-inset-top, env(safe-area-inset-top)) + 10px) 14px 10px;
  background: rgba(14, 12, 20, 0.92);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--glass-border);
}

.dce-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.dce-back {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 7px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.dce-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.25rem;
  letter-spacing: 0.04em;
  color: var(--color-text-primary);
  white-space: nowrap;
}

.dce-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dce-save-btn,
.dce-finish-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}

.dce-save-btn {
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.dce-finish-btn {
  background: var(--gradient-cosmic);
  border: none;
  color: black;
  text-transform: uppercase;
}

.dce-loading,
.dce-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 60px 20px;
  color: var(--color-text-secondary);
}

.dce-body {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Start chooser (workshop first open) — mirrors RosterSetupView's rs-start. */
.dce-start { max-width: 760px; margin: 0 auto; padding: 40px 18px; text-align: center; }
.dce-start h2 { margin: 0 0 6px; }
.dce-start-sub { color: var(--color-text-secondary); margin: 0 0 24px; }
/* The two start options split the top row; the Imports card wraps to its own
   full-width row below. */
.dce-start-grid { display: flex; flex-wrap: wrap; gap: 16px; }
.dce-start-grid > .dce-start-card { flex: 1 1 220px; }
@media (max-width: 640px) { .dce-start-grid { flex-direction: column; } }

.dce-start-card {
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
.dce-start-card:hover { border-color: var(--color-primary); background: rgba(232, 90, 79, 0.08); }
.dce-start-card:disabled { opacity: 0.6; cursor: default; }
.dce-start-name { font-weight: 700; font-size: 1.05rem; }
.dce-start-desc { color: var(--color-text-secondary); font-size: 0.85rem; }

.dce-start-downloaded {
  cursor: default;
  flex-basis: 100%;
}

.dce-build-select {
  width: 100%;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  font-size: 0.85rem;
}

.dce-start-note { margin: 14px 0 0; color: var(--color-text-secondary); font-size: 0.85rem; }
.dce-link { background: none; border: none; color: var(--color-primary); cursor: pointer; font-weight: 600; }

.dce-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.dce-count {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--color-text-primary);
}
.dce-count em {
  font-style: normal;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--color-text-tertiary);
  margin-left: 6px;
}
.dce-count.short {
  color: var(--color-warning, #f59e0b);
}

.dce-regen-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}
.dce-regen-btn:hover {
  color: var(--color-text-primary);
}

.dce-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.dce-mode-toggle {
  display: flex;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.dce-mode {
  padding: 7px 14px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}
.dce-mode.active {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
}
.dce-mode.ceiling.active {
  color: var(--color-accent, #e85a4f);
}

.dce-toolbar-hint {
  font-size: 0.68rem;
  color: var(--color-text-tertiary);
}

.dce-add-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.dce-add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px dashed var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.dce-add-btn:hover {
  color: var(--color-text-primary);
}
.dce-add-count {
  font-style: normal;
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
}
.dce-generate-btn {
  border-style: solid;
}

.dce-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.7);
}

.dce-modal {
  width: 100%;
  max-width: 380px;
  padding: 20px;
  background: var(--color-bg-primary, #1a1520);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
}

.dce-modal h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 1rem;
  color: var(--color-text-primary);
}

.dce-modal p {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
  line-height: 1.45;
}

.dce-problems {
  margin: 0 0 6px 18px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dce-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.dce-modal-primary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  background: var(--gradient-cosmic);
  border: none;
  border-radius: var(--radius-md);
  color: black;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

.dce-modal-secondary {
  padding: 9px 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.dce-add-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 10px;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.dce-add-select {
  padding: 9px 10px;
  background: var(--color-bg-tertiary, #241d2e);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 0.82rem;
}

.dce-note {
  margin-top: 8px;
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
}

.spin {
  animation: dce-spin 0.9s linear infinite;
}
@keyframes dce-spin {
  to { transform: rotate(360deg); }
}
</style>
