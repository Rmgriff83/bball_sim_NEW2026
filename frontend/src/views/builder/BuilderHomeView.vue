<script setup>
// Builder — standalone authoring workspace (custom_roster IAP). Power users
// author full league rosters or rookie draft classes DETACHED from any played
// campaign; projects are "workshop campaigns" (settings.workshopMode) that
// save + cloud-sync like campaigns but never appear in the campaign list.
// The in-campaign flows (creation-time roster setup, season-start rookie
// class) are unchanged — this is the third door for people who spend most of
// their time creating.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import {
  Loader2, Hammer, Users, ClipboardList, ArrowLeft, Plus, Pencil, Trash2,
  CloudDownload, Globe, AlertTriangle, LayoutDashboard, User, LogOut,
} from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useCampaignStore } from '@/stores/campaign'
import { useToastStore } from '@/stores/toast'
import { useAudioStore } from '@/stores/audio'
import { useSyncStore } from '@/stores/sync'
import { useCommunityLink } from '@/composables/useCommunityLink'
import { t } from '@wl-i18n/i18n.js'
import {
  createRosterWorkshop,
  createDraftClassWorkshop,
  renameWorkshop,
  MAX_WORKSHOP_PROJECTS,
} from '@/engine/campaign/WorkshopService'

const router = useRouter()
const authStore = useAuthStore()
const campaignStore = useCampaignStore()
const toastStore = useToastStore()
const { workshopCampaigns } = storeToRefs(campaignStore)
const { openCommunity, hasCommunity } = useCommunityLink()

async function handleLogout() {
  await authStore.logout()
  router.push('/login')
}

const loading = ref(true)
const creating = ref(false)
const newProjectType = ref(null) // 'roster' | 'draft_class' | null (modal closed)
const newProjectName = ref('')
const renaming = ref(null)       // project being renamed
const renameValue = ref('')
const pendingDelete = ref(null)
const deleting = ref(false)
const restoringId = ref(null)

const projects = computed(() => workshopCampaigns.value ?? [])
const atCap = computed(() => projects.value.length >= MAX_WORKSHOP_PROJECTS)

function projectMode(p) {
  return p?.settings?.workshopMode ?? null
}

onMounted(async () => {
  try {
    await campaignStore.fetchCampaigns()
  } catch { /* offline — whatever is local renders */ } finally {
    loading.value = false
  }
})

function openNewProject(type) {
  if (atCap.value) {
    toastStore.showError(t('Project limit reached ({n}) — delete one to start another.', { n: MAX_WORKSHOP_PROJECTS }))
    return
  }
  newProjectType.value = type
  newProjectName.value = type === 'draft_class' ? 'My Draft Class' : 'My Custom Roster'
}

async function confirmCreate() {
  const name = newProjectName.value.trim()
  if (!name || creating.value) return
  creating.value = true
  const audio = useAudioStore()
  audio.suppressClickSound()
  try {
    const project = newProjectType.value === 'draft_class'
      ? await createDraftClassWorkshop(name)
      : await createRosterWorkshop(name)
    // Push right away so the server stamps `workshop` on the row (that stamp
    // is what keeps the project invisible to old app versions).
    try {
      const syncStore = useSyncStore()
      syncStore.setActiveCampaign(project.id)
      await syncStore.pushChanges(project.id, { isolated: true })
    } catch { /* event-driven sync retries */ }
    await campaignStore.fetchCampaigns().catch(() => {})
    audio.affirm()
    openProjectById(project.id, newProjectType.value)
    newProjectType.value = null
  } catch (err) {
    audio.cancel()
    toastStore.showError(err?.message || t('Could not create the project'))
  } finally {
    creating.value = false
  }
}

function openProjectById(id, mode) {
  router.push(mode === 'draft_class'
    ? `/campaign/${id}/rookie-class`
    : `/campaign/${id}/roster-setup`)
}

async function openProject(p) {
  if (p.cloudOnly) {
    await restoreProject(p)
    return
  }
  openProjectById(p.id, projectMode(p))
}

async function restoreProject(p) {
  if (restoringId.value) return
  restoringId.value = p.id
  try {
    await campaignStore.restoreCloudCampaign(p.id)
    toastStore.showSuccess(t('Project restored from the cloud'))
  } catch (err) {
    toastStore.showError(err?.message || t('Restore failed — check your connection'))
  } finally {
    restoringId.value = null
  }
}

function startRename(p) {
  renaming.value = p
  renameValue.value = p.name ?? ''
}

async function confirmRename() {
  const p = renaming.value
  const name = renameValue.value.trim()
  renaming.value = null
  if (!p || !name || name === p.name) return
  try {
    await renameWorkshop(p.id, name)
    const syncStore = useSyncStore()
    syncStore.setActiveCampaign(p.id)
    syncStore.markDirty('workshop_rename')
    await campaignStore.fetchCampaigns().catch(() => {})
  } catch (err) {
    toastStore.showError(err?.message || t('Rename failed'))
  }
}

async function confirmDelete() {
  const p = pendingDelete.value
  if (!p || deleting.value) return
  deleting.value = true
  try {
    await campaignStore.deleteCampaign(p.id)
    pendingDelete.value = null
    toastStore.showSuccess(t('Project deleted'))
  } catch (err) {
    toastStore.showError(err?.message || t('Delete failed'))
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="bld">
    <!-- Standard site header (mirrors CampaignsView's campaigns-header) so the
         Builder carries the same top navigation. -->
    <header class="campaigns-header">
      <div class="header-container">
        <!-- i18n-ignore -->
        <router-link to="/dashboard" class="app-logo">BBALL SIM</router-link>
        <nav class="header-nav">
          <router-link to="/dashboard" class="nav-link">
            <LayoutDashboard :size="18" />
            <span>{{ $t('Dashboard') }}</span>
          </router-link>
          <button v-if="hasCommunity" class="nav-link" @click="openCommunity(null, { back: 'builder' })">
            <Globe :size="18" />
            <span>{{ $t('Community') }}</span>
          </button>
          <span class="nav-link current-page">
            <Hammer :size="18" />
            <span>{{ $t('Builder') }}</span>
          </span>
          <router-link to="/profile" class="nav-link">
            <User :size="18" />
            <span>{{ $t('Profile') }}</span>
          </router-link>
          <button @click="handleLogout" class="nav-link logout-btn">
            <LogOut :size="18" />
            <span>{{ $t('Sign Out') }}</span>
          </button>
        </nav>
      </div>
    </header>

    <!-- Page content — carries the width cap + padding so the site header
         above stays full-bleed like on the campaigns screen. -->
    <div class="bld-content">
    <header class="bld-header">
      <button class="bld-back" @click="router.push('/campaigns')">
        <ArrowLeft :size="18" /> {{ $t('Campaigns') }}
      </button>
      <h1 class="bld-title"><Hammer :size="20" /> {{ $t('Builder') }}</h1>
      <button class="bld-community" @click="openCommunity(null, { back: 'builder' })">
        <Globe :size="14" /> {{ $t('Community') }}
      </button>
    </header>

    <p class="bld-sub">
      {{ $t('Author full league rosters or rookie draft classes outside any campaign. Projects save automatically, sync to your account, and can be published to the Community board.') }}
    </p>

    <div class="bld-new-grid">
      <button class="bld-new-card" :disabled="creating" @click="openNewProject('roster')">
        <Users :size="26" />
        <span class="bld-new-name">{{ $t('New Roster Build') }}</span>
        <span class="bld-new-desc">{{ $t('A full 30-team league — start from a generated base and reshape everything.') }}</span>
      </button>
      <button class="bld-new-card" :disabled="creating" @click="openNewProject('draft_class')">
        <ClipboardList :size="26" />
        <span class="bld-new-name">{{ $t('New Draft Class') }}</span>
        <span class="bld-new-desc">{{ $t('A rookie class (60–120 prospects) campaigns can adopt at any season start.') }}</span>
      </button>
    </div>

    <div v-if="loading" class="bld-loading"><Loader2 :size="26" class="spin" /> {{ $t('Loading projects…') }}</div>

    <template v-else>
      <h2 v-if="projects.length" class="bld-section">{{ $t('Your Projects ({a}/{b})', { a: projects.length, b: MAX_WORKSHOP_PROJECTS }) }}</h2>
      <p v-else class="bld-empty">{{ $t('No projects yet — start one above.') }}</p>

      <div class="bld-list">
        <div v-for="p in projects" :key="p.id" class="bld-card">
          <button class="bld-card-main" @click="openProject(p)">
            <span class="bld-card-name">{{ p.name }}</span>
            <span class="bld-card-meta">
              <span class="bld-chip" :class="projectMode(p) ?? 'cloud'">
                {{ p.cloudOnly ? $t('Cloud') : (projectMode(p) === 'draft_class' ? $t('Draft Class') : $t('Roster')) }}
              </span>
              <span v-if="p.updatedAt" class="bld-updated">{{ new Date(p.updatedAt).toLocaleDateString() }}</span>
            </span>
          </button>
          <div class="bld-card-actions">
            <button v-if="p.cloudOnly" class="bld-icon-btn" :title="$t('Restore from cloud')" :disabled="restoringId === p.id" @click="restoreProject(p)">
              <Loader2 v-if="restoringId === p.id" :size="15" class="spin" />
              <CloudDownload v-else :size="15" />
            </button>
            <template v-else>
              <button class="bld-icon-btn" :title="$t('Rename')" @click="startRename(p)"><Pencil :size="15" /></button>
              <button class="bld-icon-btn danger" :title="$t('Delete')" @click="pendingDelete = p"><Trash2 :size="15" /></button>
            </template>
          </div>
        </div>
      </div>
    </template>

    <!-- New project name -->
    <div v-if="newProjectType" class="bld-modal-overlay">
      <div class="bld-modal">
        <h3><Plus :size="18" /> {{ newProjectType === 'draft_class' ? $t('New Draft Class') : $t('New Roster Build') }}</h3>
        <label class="bld-field">
          <span>{{ $t('Project name') }}</span>
          <input v-model="newProjectName" maxlength="60" class="bld-input" @keyup.enter="confirmCreate" />
        </label>
        <p class="bld-note">
          {{ newProjectType === 'roster' ? $t('Generates a full league, then the editor asks how to start — from generated, scratch, or an import.') : $t('The editor will ask how to start — from a generated class, from scratch, or from an import.') }}
        </p>
        <div class="bld-modal-actions">
          <button class="bld-secondary" :disabled="creating" @click="newProjectType = null">{{ $t('Cancel') }}</button>
          <button class="bld-primary" :disabled="creating || !newProjectName.trim()" @click="confirmCreate">
            <Loader2 v-if="creating" :size="15" class="spin" />
            {{ $t('Create') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Rename -->
    <div v-if="renaming" class="bld-modal-overlay">
      <div class="bld-modal">
        <h3><Pencil :size="18" /> {{ $t('Rename Project') }}</h3>
        <label class="bld-field">
          <span>{{ $t('Project name') }}</span>
          <input v-model="renameValue" maxlength="60" class="bld-input" @keyup.enter="confirmRename" />
        </label>
        <div class="bld-modal-actions">
          <button class="bld-secondary" @click="renaming = null">{{ $t('Cancel') }}</button>
          <button class="bld-primary" :disabled="!renameValue.trim()" @click="confirmRename">{{ $t('Save') }}</button>
        </div>
      </div>
    </div>

    <!-- Delete confirm -->
    <div v-if="pendingDelete" class="bld-modal-overlay">
      <div class="bld-modal">
        <h3><AlertTriangle :size="18" /> {{ $t('Delete project') }}</h3>
        <p class="bld-modal-text">
          {{ $t("Delete {name} everywhere (this device and the cloud)? Published community builds are unaffected. This can't be undone.", { name: pendingDelete.name }) }}
        </p>
        <div class="bld-modal-actions">
          <button class="bld-secondary" @click="pendingDelete = null">{{ $t('Cancel') }}</button>
          <button class="bld-primary danger" :disabled="deleting" @click="confirmDelete">
            <Loader2 v-if="deleting" :size="15" class="spin" />
            {{ $t('Delete') }}
          </button>
        </div>
      </div>
    </div>
    </div>
  </div>
</template>

<style scoped>
/* Full-width so the sticky site header can bleed edge-to-edge; the width cap
   and padding moved to .bld-content below. */
.bld {
  min-height: 100vh;
}

.bld-content {
  max-width: 760px;
  margin: 0 auto;
  padding: 14px 16px 80px;
}

/* Site header — mirrors CampaignsView's campaigns-header styles (scoped CSS
   doesn't cross views, so the rules are duplicated here). */
.campaigns-header {
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--glass-border);
  position: sticky;
  top: 0;
  z-index: 40;
  backdrop-filter: blur(12px);
}

.header-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.app-logo {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  background: linear-gradient(135deg, var(--color-primary), #F4A259);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.header-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  border-radius: var(--radius-lg);
  transition: all 0.2s ease;
  background: transparent;
  border: none;
  cursor: pointer;
}

.nav-link:hover {
  color: var(--color-text-primary);
  background: var(--glass-bg);
}

.nav-link.current-page {
  color: var(--color-text-primary);
  background: var(--glass-bg);
  cursor: default;
}

.logout-btn:hover {
  color: #EF4444;
}

@media (max-width: 768px) {
  .nav-link span {
    display: none;
  }

  .nav-link {
    padding: 0.5rem;
  }
}

.bld-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.bld-back,
.bld-community {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 11px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.bld-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: var(--color-text-primary);
}

.bld-sub {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
  line-height: 1.45;
  margin-bottom: 16px;
}

.bld-new-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 10px;
  margin-bottom: 22px;
}

.bld-new-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-accent, #e85a4f);
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}
.bld-new-card:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  transform: translateY(-1px);
}

.bld-new-name {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.bld-new-desc {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  line-height: 1.35;
}

.bld-section {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
  margin-bottom: 10px;
}

.bld-loading,
.bld-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px 12px;
  color: var(--color-text-secondary);
}

.bld-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bld-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 0;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.bld-card-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 14px;
  background: none;
  border: none;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
}

.bld-card-name {
  font-size: 0.92rem;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.bld-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bld-chip {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.62rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: rgba(94, 155, 255, 0.15);
  color: #7fb0ff;
}
.bld-chip.draft_class {
  background: rgba(168, 121, 255, 0.15);
  color: #c2a2ff;
}
.bld-chip.cloud {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-tertiary);
}

.bld-updated {
  font-size: 0.68rem;
  color: var(--color-text-tertiary);
}

.bld-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.bld-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.bld-icon-btn:hover {
  color: var(--color-text-primary);
}
.bld-icon-btn.danger:hover {
  color: var(--color-error, #ef4444);
}

.bld-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.7);
}

.bld-modal {
  width: 100%;
  max-width: 360px;
  padding: 20px;
  background: var(--color-bg-primary, #1a1520);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
}

.bld-modal h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 1rem;
  color: var(--color-text-primary);
}

.bld-modal-text {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
  line-height: 1.45;
}

.bld-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}

.bld-input {
  padding: 10px;
  background: var(--color-bg-tertiary, #241d2e);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 0.9rem;
  font-family: inherit;
}

.bld-note {
  margin-top: 8px;
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
}

.bld-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.bld-primary {
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
.bld-primary.danger {
  background: var(--color-error, #ef4444);
  color: white;
}
.bld-primary:disabled {
  opacity: 0.65;
  cursor: default;
}

.bld-secondary {
  padding: 9px 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.spin {
  animation: bld-spin 0.9s linear infinite;
}
@keyframes bld-spin {
  to { transform: rotate(360deg); }
}
</style>
