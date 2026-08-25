<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Loader2, Globe, Upload, Download, Flag, ArrowLeft, Check, ShieldAlert, LayoutDashboard, Hammer, User, LogOut } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useCampaignStore } from '@/stores/campaign'
import { useToastStore } from '@/stores/toast'
import api from '@/composables/useApi'
import { t } from '@wl-i18n/i18n.js'

// Community roster board (Roster Editor IAP Part B) — WEB-ONLY. All sharing,
// browsing, downloading, and reporting happens here; the app only links in
// via the login handoff. Server enforces the custom_roster entitlement on
// every endpoint — the client gate below is UX only.
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const campaignStore = useCampaignStore()
const toastStore = useToastStore()

async function handleLogout() {
  await authStore.logout()
  router.push('/login')
}

const isOwner = computed(() => authStore.hasFeature('custom_roster'))

// Content type: full league rosters vs rookie draft classes. Same board/
// publish/imports machinery, same endpoints — the ?type= param discriminates
// server-side. Deep links land directly on a type via ?type=draft_class.
const contentType = ref(route.query.type === 'draft_class' ? 'draft_class' : 'roster')
const isDraftClass = computed(() => contentType.value === 'draft_class')

const tab = ref('board') // 'board' | 'publish' | 'downloads'
const loading = ref(false)
const builds = ref([])
const myDownloads = ref([])
const sort = ref('created_at')
const page = ref(1)
const lastPage = ref(1)

function switchContentType(type) {
  if (contentType.value === type) return
  contentType.value = type
  page.value = 1
  publishCampaignId.value = ''
  fetchBoard()
  fetchMyDownloads()
  fetchPublishedCampaigns()
}

// Publish panel state
const publishCampaignId = ref('')
const publishTitle = ref('')
const publishDescription = ref('')
const publishAck = ref(false)
const publishing = ref(false)

// Return-to-app: the handoff passes ?campaign=<clientId>, so we can send the
// user straight back to that campaign's roster-setup page. Visitors who came
// from the NATIVE app (via the /autologin handoff, which stamps this session
// flag) go back through the bballsim:// deep link; ordinary web-app visitors
// just navigate in-app — firing the deep link in a plain browser errors with
// "scheme does not have a registered handler".
const fromNativeApp = (() => {
  try { return sessionStorage.getItem('bball_from_native_app') === '1' } catch { return false }
})()
const returnCampaign = computed(() => String(route.query.campaign ?? ''))
// ?back= names the in-app spot the visit came from: 'rookie-class' (the
// season-start rookie-class modal — reopened via ?rookieClass=1), 'builder'
// (the standalone Builder), else the original roster-setup round trip.
const backIntent = computed(() => String(route.query.back ?? ''))
const backPath = computed(() => {
  if (backIntent.value === 'builder') return '/builder'
  if (backIntent.value === 'rookie-class' && returnCampaign.value) {
    return `/campaign/${returnCampaign.value}?rookieClass=1`
  }
  return returnCampaign.value
    ? `/campaign/${returnCampaign.value}/roster-setup`
    : '/campaigns'
})
const backToAppUrl = computed(() => `bballsim://open?path=${encodeURIComponent(backPath.value)}`)

// Campaigns whose custom roster already has a LIVE build on the board — each
// campaign can only be published once (removing a build frees it again).
const publishedCampaignIds = ref(new Set())
async function fetchPublishedCampaigns() {
  try {
    const res = await api.get('/api/roster-builds/mine', {
      params: { type: contentType.value },
      skipErrorToast: true,
    })
    publishedCampaignIds.value = new Set(
      (res.data?.builds ?? [])
        .filter((b) => b.status === 'active' && b.campaign_client_id)
        .map((b) => b.campaign_client_id)
    )
  } catch { /* picker just won't pre-filter; the server still enforces */ }
}

// Builder workshop projects (roster or draft-class WIPs) — exposed by the
// campaign store split; `?? []` keeps this page working against store
// snapshots hydrated before that field existed.
const workshopProjects = computed(() => campaignStore.workshopCampaigns ?? [])

// Per-type publish picker (already-published campaigns of the SAME type stay
// out; a campaign can have one roster AND one draft-class build live).
// Rosters: finished custom campaigns + Builder roster projects that passed
// "Validate for publishing". Draft classes: ANY campaign (every campaign
// carries a generated class) + Builder draft-class projects.
const publishableCampaigns = computed(() => {
  let workshops
  let regular
  if (isDraftClass.value) {
    workshops = workshopProjects.value.filter((c) => c.settings?.workshopMode === 'draft_class')
    regular = campaignStore.campaigns ?? []
  } else {
    workshops = workshopProjects.value.filter((c) =>
      c.settings?.workshopMode === 'roster' && c.settings?.workshopPublishable)
    regular = (campaignStore.campaigns ?? []).filter((c) =>
      (c.customRoster ?? c.custom_roster)
      && (c.rosterSetupCompleted ?? c.roster_setup_completed))
  }
  return [
    ...workshops.map((c) => ({ ...c, _workshop: true })),
    ...regular,
  ].filter((c) => !publishedCampaignIds.value.has(c.id))
})

async function fetchBoard() {
  loading.value = true
  try {
    const res = await api.get('/api/roster-builds', {
      params: { sort: sort.value, page: page.value, type: contentType.value },
    })
    builds.value = res.data?.builds ?? []
    lastPage.value = res.data?.last_page ?? 1
  } catch {
    builds.value = []
  } finally {
    loading.value = false
  }
}

async function fetchMyDownloads() {
  try {
    const res = await api.get('/api/roster-builds/downloads', {
      params: { type: contentType.value },
      skipErrorToast: true,
    })
    myDownloads.value = res.data?.builds ?? []
  } catch {
    myDownloads.value = []
  }
}

const downloadedIds = computed(() => new Set(myDownloads.value.map((b) => b.id)))

async function downloadBuild(build) {
  try {
    await api.post(`/api/roster-builds/${build.id}/download`)
    // Rich callout + affirmation chime (played inside showAchievement).
    toastStore.showAchievement({
      header: isDraftClass.value ? t('Draft Class Imported') : t('Roster Imported'),
      label: build.title,
      subtitle: isDraftClass.value
        ? t('Imported to your account — offer it as the rookie class when a new season starts.')
        : t('Imported to your account — available when starting any new custom campaign.'),
      type: 'roster_import',
    })
    fetchMyDownloads()
  } catch (err) {
    toastStore.showError(err?.response?.data?.message || t('Import failed'))
  }
}

async function reportBuild(build) {
  const reason = window.prompt(t('What is wrong with this roster? (optional)'))
  if (reason === null) return
  try {
    await api.post(`/api/roster-builds/${build.id}/report`, { reason: reason || null })
    toastStore.showSuccess(t('Reported. Thank you — we review every report.'))
  } catch (err) {
    toastStore.showError(err?.response?.data?.message || t('Report failed'))
  }
}

async function publish() {
  if (!publishCampaignId.value || !publishTitle.value.trim() || !publishAck.value || publishing.value) return
  publishing.value = true
  try {
    await api.post('/api/roster-builds', {
      campaign_client_id: publishCampaignId.value,
      title: publishTitle.value.trim(),
      description: publishDescription.value.trim() || null,
      type: contentType.value,
    })
    toastStore.showSuccess(isDraftClass.value
      ? t('Published! Your draft class is live on the board.')
      : t('Published! Your roster is live on the board.'))
    publishTitle.value = ''
    publishDescription.value = ''
    publishAck.value = false
    publishCampaignId.value = ''
    tab.value = 'board'
    fetchBoard()
    fetchPublishedCampaigns()
  } catch (err) {
    const data = err?.response?.data
    if (data?.error === 'content_rejected') {
      toastStore.showError(
        data.source
          ? t('Publish blocked: disallowed language in {source}. Rename it in the app, sync, and retry.', { source: data.source })
          : t('Publish blocked: a name or description contains disallowed language.'),
        6000
      )
    } else if (data?.error === 'campaign_not_synced') {
      toastStore.showError(t('This campaign has not finished syncing yet — open it in the app first, then retry.'))
    } else if (data?.error === 'not_a_custom_campaign') {
      toastStore.showError(t('Only custom-roster campaigns can be published.'))
    } else if (data?.error === 'campaign_not_finalized') {
      toastStore.showError(t('Finish building this roster in the app (start the campaign) before publishing it. Builder projects need "Validate for publishing" first.'))
    } else if (data?.error === 'no_draft_class') {
      toastStore.showError(t('This campaign has no rookie class synced yet — open it in the app so it syncs, then retry.'))
    } else if (data?.error === 'class_too_small') {
      toastStore.showError(t('This class has {count} prospects — the draft needs at least {min}. Add more in the class editor first.', { count: data.count, min: data.min ?? 60 }))
    } else if (data?.error === 'class_too_large') {
      toastStore.showError(t('This class has {count} prospects — the max is {max}. Trim it in the class editor first.', { count: data.count, max: data.max ?? 120 }))
    } else if (data?.error === 'already_published') {
      toastStore.showError(isDraftClass.value
        ? t("This campaign's draft class is already on the board — remove that build to re-publish.")
        : t("This campaign's roster is already on the board — each campaign can only be published once."))
      fetchPublishedCampaigns()
    } else if (data?.error === 'storage_unavailable') {
      toastStore.showError(t('Upload storage is temporarily unavailable — please try again shortly.'))
    } else {
      toastStore.showError(data?.message || t('Publish failed'))
    }
  } finally {
    publishing.value = false
  }
}

function fmtSize(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

onMounted(async () => {
  if (!isOwner.value) return
  fetchBoard()
  fetchMyDownloads()
  fetchPublishedCampaigns()
  await campaignStore.fetchCampaigns().catch(() => {})
  if (returnCampaign.value && publishableCampaigns.value.some((c) => c.id === returnCampaign.value)) {
    publishCampaignId.value = returnCampaign.value
  }
})
</script>

<template>
  <div class="community">
    <!-- Standard site header (mirrors CampaignsView's campaigns-header) so
         the web community board carries the same top navigation. -->
    <header class="campaigns-header">
      <div class="header-container">
        <!-- i18n-ignore -->
        <router-link to="/dashboard" class="app-logo">BBALL SIM</router-link>
        <nav class="header-nav">
          <router-link to="/dashboard" class="nav-link">
            <LayoutDashboard :size="18" />
            <span>{{ $t('Dashboard') }}</span>
          </router-link>
          <span class="nav-link current-page">
            <Globe :size="18" />
            <span>{{ $t('Community') }}</span>
          </span>
          <router-link v-if="canCustomRoster" to="/builder" class="nav-link">
            <Hammer :size="18" />
            <span>{{ $t('Builder') }}</span>
          </router-link>
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
    <div class="community-content">
    <header class="cm-header">
      <h1 class="cm-title"><Globe :size="22" /> {{ isDraftClass ? $t('Community Draft Classes') : $t('Community Rosters') }}</h1>
      <a v-if="fromNativeApp" class="cm-back-app" :href="backToAppUrl">
        <ArrowLeft :size="15" /> {{ $t('Back to app') }}
      </a>
      <router-link v-else class="cm-back-app" :to="backPath">
        <ArrowLeft :size="15" /> {{ $t('Back to app') }}
      </router-link>
    </header>

    <!-- Upsell for non-owners (server enforces regardless) -->
    <div v-if="!isOwner" class="cm-upsell">
      <ShieldAlert :size="28" />
      <p>
        {{ $t('The community roster board is part of the Roster Editor — a one-time purchase available in the in-app store.') }}
      </p>
    </div>

    <template v-else>
      <!-- Content-type toggle: full league rosters vs rookie draft classes.
           Board / Publish / My Imports all follow the selected type. -->
      <nav class="cm-type-toggle">
        <button
          class="cm-type"
          :class="{ active: !isDraftClass }"
          @click="switchContentType('roster')"
        >{{ $t('Rosters') }}</button>
        <button
          class="cm-type"
          :class="{ active: isDraftClass }"
          @click="switchContentType('draft_class')"
        >{{ $t('Draft Classes') }}</button>
      </nav>

      <nav class="cm-tabs">
        <button class="cm-tab" :class="{ active: tab === 'board' }" @click="tab = 'board'; fetchBoard()">{{ $t('Board') }}</button>
        <button class="cm-tab" :class="{ active: tab === 'publish' }" @click="tab = 'publish'">
          <Upload :size="13" /> {{ $t('Publish') }}
        </button>
        <button class="cm-tab" :class="{ active: tab === 'downloads' }" @click="tab = 'downloads'; fetchMyDownloads()">
          {{ $t('My Imports') }}
        </button>
      </nav>

      <!-- Board -->
      <section v-if="tab === 'board'">
        <div class="cm-toolbar">
          <select v-model="sort" class="cm-select" @change="page = 1; fetchBoard()">
            <option value="created_at">{{ $t('Newest') }}</option>
            <option value="downloads">{{ $t('Most imported') }}</option>
          </select>
        </div>
        <div v-if="loading" class="cm-loading"><Loader2 :size="26" class="spin" /></div>
        <p v-else-if="!builds.length" class="cm-empty">
          {{ isDraftClass ? $t('No draft classes published yet — be the first!') : $t('No rosters published yet — be the first!') }}
        </p>
        <div v-else class="cm-list">
          <div v-for="b in builds" :key="b.id" class="cm-card">
            <div class="cm-card-info">
              <span class="cm-card-title">{{ b.title }}</span>
              <span class="cm-card-meta">{{ isDraftClass ? $t('by {author} · {count} prospects · {size} · {downloads} imports', { author: b.author ?? $t('Unknown'), count: b.player_count, size: fmtSize(b.size_bytes), downloads: b.downloads }) : $t('by {author} · {count} players · {size} · {downloads} imports', { author: b.author ?? $t('Unknown'), count: b.player_count, size: fmtSize(b.size_bytes), downloads: b.downloads }) }}</span>
              <p v-if="b.description" class="cm-card-desc">{{ b.description }}</p>
            </div>
            <div class="cm-card-actions">
              <button
                class="cm-primary"
                :disabled="downloadedIds.has(b.id)"
                @click="downloadBuild(b)"
              >
                <Check v-if="downloadedIds.has(b.id)" :size="14" />
                <Download v-else :size="14" />
                {{ downloadedIds.has(b.id) ? $t('Imported') : $t('Import') }}
              </button>
              <button class="cm-ghost" :title="isDraftClass ? $t('Report this draft class') : $t('Report this roster')" @click="reportBuild(b)">
                <Flag :size="13" />
              </button>
            </div>
          </div>
        </div>
        <div v-if="lastPage > 1" class="cm-pager">
          <button class="cm-ghost" :disabled="page <= 1" @click="page--; fetchBoard()">{{ $t('‹ Prev') }}</button>
          <span>{{ page }} / {{ lastPage }}</span>
          <button class="cm-ghost" :disabled="page >= lastPage" @click="page++; fetchBoard()">{{ $t('Next ›') }}</button>
        </div>
      </section>

      <!-- Publish -->
      <section v-else-if="tab === 'publish'" class="cm-publish">
        <p v-if="!publishableCampaigns.length" class="cm-empty">
          {{ isDraftClass ? $t('No campaigns available to publish a draft class from — open a campaign (or create a Builder draft-class project) in the app so it syncs, then publish it here.') : $t('No custom-roster campaigns on this account yet — create one in the app with the Custom league-roster option, then publish it here.') }}
        </p>
        <template v-else>
          <label class="cm-field">
            <span>{{ isDraftClass ? $t('Source campaign / project') : $t('Campaign') }}</span>
            <select v-model="publishCampaignId" class="cm-select">
              <option value="" disabled>{{ isDraftClass ? $t('Choose a campaign or Builder project…') : $t('Choose a custom campaign…') }}</option>
              <option v-for="c in publishableCampaigns" :key="c.id" :value="c.id">
                {{ c._workshop ? $t('{name} — Workshop', { name: c.name }) : c.name }}
              </option>
            </select>
            <em v-if="isDraftClass" class="cm-field-hint">
              {{ $t("Publishes the campaign's CURRENT season rookie class as last synced from the app.") }}
            </em>
          </label>
          <label class="cm-field">
            <span>{{ $t('Title') }}</span>
            <input v-model="publishTitle" maxlength="100" class="cm-input" :placeholder="isDraftClass ? $t('e.g. Loaded 2028 Class') : $t('e.g. 2010s Golden Era Remix')" />
          </label>
          <label class="cm-field">
            <span>{{ $t('Description (optional)') }}</span>
            <textarea v-model="publishDescription" maxlength="1000" rows="3" class="cm-input"></textarea>
          </label>
          <label class="cm-ack">
            <input v-model="publishAck" type="checkbox" />
            <span>
              {{ $t("I'm responsible for the content I publish and have the right to share it. Content may be removed in response to reports or rights-holder requests.") }}
            </span>
          </label>
          <button
            class="cm-primary lg"
            :disabled="!publishCampaignId || !publishTitle.trim() || !publishAck || publishing"
            @click="publish"
          >
            <Loader2 v-if="publishing" :size="15" class="spin" />
            <Upload v-else :size="15" />
            {{ $t('Publish to the Board') }}
          </button>
        </template>
      </section>

      <!-- My Downloads -->
      <section v-else>
        <p v-if="!myDownloads.length" class="cm-empty">
          {{ isDraftClass ? $t('Nothing imported yet — import a draft class from the board and it will be offered as the rookie class when a new season starts in the app.') : $t('Nothing imported yet — import a roster from the board and it will appear under "Imports" when starting a custom campaign in the app.') }}
        </p>
        <div v-else class="cm-list">
          <div v-for="b in myDownloads" :key="b.id" class="cm-card">
            <div class="cm-card-info">
              <span class="cm-card-title">{{ b.title }}</span>
              <span class="cm-card-meta">{{ isDraftClass ? $t('by {author} · {count} prospects', { author: b.author ?? $t('Unknown'), count: b.player_count }) : $t('by {author} · {count} players', { author: b.author ?? $t('Unknown'), count: b.player_count }) }}</span>
            </div>
            <span class="cm-saved-tag"><Check :size="13" /> {{ $t('Available in app') }}</span>
          </div>
        </div>
      </section>
    </template>
    </div><!-- /community-content -->
  </div>
</template>

<style scoped>
.community {
  /* Full-bleed wrapper — width cap + padding live on .community-content so
     the sticky site header spans the whole viewport. */
}

.community-content {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 18px 80px;
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

.cm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.cm-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.8rem;
  font-weight: 400;
  color: var(--color-text-primary);
}

.cm-back-app {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--color-text-primary);
  font-weight: 700;
  font-size: 0.82rem;
  text-decoration: none;
}

.cm-back-app:hover { border-color: var(--color-primary); }

.cm-upsell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 20px;
  text-align: center;
  color: var(--color-text-secondary);
}

.cm-type-toggle {
  display: inline-flex;
  margin-bottom: 14px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg, 12px);
  overflow: hidden;
}

.cm-type {
  padding: 9px 18px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  font-weight: 700;
  font-size: 0.85rem;
  cursor: pointer;
}

.cm-type.active {
  background: var(--gradient-cosmic);
  color: #1a1520;
}

.cm-field-hint {
  font-style: normal;
  font-size: 0.68rem;
  font-weight: 500;
  text-transform: none;
  color: var(--color-text-tertiary);
}

.cm-tabs { display: flex; gap: 8px; margin-bottom: 16px; }

.cm-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--radius-lg, 12px);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  font-weight: 600;
  cursor: pointer;
}

.cm-tab.active {
  background: var(--gradient-cosmic);
  color: #1a1520;
  font-weight: 700;
  border-color: rgba(255, 255, 255, 0.2);
}

.cm-toolbar { display: flex; justify-content: flex-end; margin-bottom: 10px; }

.cm-select, .cm-input {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 0.9rem;
  font-family: inherit;
}

.cm-loading { display: flex; justify-content: center; padding: 40px; }
.cm-empty { text-align: center; color: var(--color-text-secondary); padding: 32px 12px; }

.cm-list { display: flex; flex-direction: column; gap: 10px; }

.cm-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--radius-lg, 12px);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.cm-card-info { min-width: 0; }
.cm-card-title { display: block; font-weight: 700; color: var(--color-text-primary); }
.cm-card-meta { font-size: 0.74rem; color: var(--color-text-tertiary); }
.cm-card-desc { margin: 6px 0 0; font-size: 0.82rem; color: var(--color-text-secondary); }
.cm-card-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.cm-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 10px;
  border: none;
  background: var(--color-primary);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.cm-primary:disabled { opacity: 0.65; cursor: default; }
.cm-primary.lg { padding: 12px 20px; align-self: flex-start; }

.cm-ghost {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.cm-ghost:disabled { opacity: 0.5; cursor: default; }

.cm-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin-top: 16px;
  color: var(--color-text-secondary);
}

.cm-publish { display: flex; flex-direction: column; gap: 14px; max-width: 560px; }
.cm-field { display: flex; flex-direction: column; gap: 5px; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: var(--color-text-secondary); }

.cm-ack {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  line-height: 1.45;
}

.cm-ack input { margin-top: 3px; accent-color: var(--color-primary); }

.cm-saved-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--color-success);
  white-space: nowrap;
}

.spin { animation: cm-spin 1s linear infinite; }
@keyframes cm-spin { to { transform: rotate(360deg); } }
</style>
