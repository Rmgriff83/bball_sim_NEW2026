<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Loader2, Globe, Upload, Download, Flag, ArrowLeft, Check, ShieldAlert } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useCampaignStore } from '@/stores/campaign'
import { useToastStore } from '@/stores/toast'
import api from '@/composables/useApi'

// Community roster board (Roster Editor IAP Part B) — WEB-ONLY. All sharing,
// browsing, downloading, and reporting happens here; the app only links in
// via the login handoff. Server enforces the custom_roster entitlement on
// every endpoint — the client gate below is UX only.
const route = useRoute()
const authStore = useAuthStore()
const campaignStore = useCampaignStore()
const toastStore = useToastStore()

const isOwner = computed(() => authStore.hasFeature('custom_roster'))

const tab = ref('board') // 'board' | 'publish' | 'downloads'
const loading = ref(false)
const builds = ref([])
const myDownloads = ref([])
const sort = ref('created_at')
const page = ref(1)
const lastPage = ref(1)

// Publish panel state
const publishCampaignId = ref('')
const publishTitle = ref('')
const publishDescription = ref('')
const publishAck = ref(false)
const publishing = ref(false)

// Return-to-app deep link: the handoff passes ?campaign=<clientId>, so we can
// send the user straight back to that campaign's roster-setup page.
const returnCampaign = computed(() => String(route.query.campaign ?? ''))
const backToAppUrl = computed(() => {
  const path = returnCampaign.value
    ? `/campaign/${returnCampaign.value}/roster-setup`
    : '/campaigns'
  return `bballsim://open?path=${encodeURIComponent(path)}`
})

const customCampaigns = computed(() =>
  (campaignStore.campaigns ?? []).filter((c) => c.customRoster ?? c.custom_roster))

async function fetchBoard() {
  loading.value = true
  try {
    const res = await api.get('/api/roster-builds', { params: { sort: sort.value, page: page.value } })
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
    const res = await api.get('/api/roster-builds/downloads', { skipErrorToast: true })
    myDownloads.value = res.data?.builds ?? []
  } catch {
    myDownloads.value = []
  }
}

const downloadedIds = computed(() => new Set(myDownloads.value.map((b) => b.id)))

async function downloadBuild(build) {
  try {
    await api.post(`/api/roster-builds/${build.id}/download`)
    toastStore.showSuccess('Saved to your account — find it in the app under "Start from Downloaded".', 5000)
    fetchMyDownloads()
  } catch (err) {
    toastStore.showError(err?.response?.data?.message || 'Download failed')
  }
}

async function reportBuild(build) {
  const reason = window.prompt('What is wrong with this roster? (optional)')
  if (reason === null) return
  try {
    await api.post(`/api/roster-builds/${build.id}/report`, { reason: reason || null })
    toastStore.showSuccess('Reported. Thank you — we review every report.')
  } catch (err) {
    toastStore.showError(err?.response?.data?.message || 'Report failed')
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
    })
    toastStore.showSuccess('Published! Your roster is live on the board.')
    publishTitle.value = ''
    publishDescription.value = ''
    publishAck.value = false
    tab.value = 'board'
    fetchBoard()
  } catch (err) {
    const data = err?.response?.data
    if (data?.error === 'content_rejected') {
      toastStore.showError('Publish blocked: a name or description contains disallowed language.')
    } else if (data?.error === 'campaign_not_synced') {
      toastStore.showError('This campaign has not finished syncing yet — open it in the app first, then retry.')
    } else if (data?.error === 'not_a_custom_campaign') {
      toastStore.showError('Only custom-roster campaigns can be published.')
    } else {
      toastStore.showError(data?.message || 'Publish failed')
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
  await campaignStore.fetchCampaigns().catch(() => {})
  if (returnCampaign.value && customCampaigns.value.some((c) => c.id === returnCampaign.value)) {
    publishCampaignId.value = returnCampaign.value
  }
})
</script>

<template>
  <div class="community">
    <header class="cm-header">
      <h1 class="cm-title"><Globe :size="22" /> Community Rosters</h1>
      <a class="cm-back-app" :href="backToAppUrl">
        <ArrowLeft :size="15" /> Back to app
      </a>
    </header>

    <!-- Upsell for non-owners (server enforces regardless) -->
    <div v-if="!isOwner" class="cm-upsell">
      <ShieldAlert :size="28" />
      <p>
        The community roster board is part of the <strong>Roster Editor</strong> —
        a one-time purchase available in the in-app store.
      </p>
    </div>

    <template v-else>
      <nav class="cm-tabs">
        <button class="cm-tab" :class="{ active: tab === 'board' }" @click="tab = 'board'; fetchBoard()">Board</button>
        <button class="cm-tab" :class="{ active: tab === 'publish' }" @click="tab = 'publish'">
          <Upload :size="13" /> Publish
        </button>
        <button class="cm-tab" :class="{ active: tab === 'downloads' }" @click="tab = 'downloads'; fetchMyDownloads()">
          My Downloads
        </button>
      </nav>

      <!-- Board -->
      <section v-if="tab === 'board'">
        <div class="cm-toolbar">
          <select v-model="sort" class="cm-select" @change="page = 1; fetchBoard()">
            <option value="created_at">Newest</option>
            <option value="downloads">Most downloaded</option>
          </select>
        </div>
        <div v-if="loading" class="cm-loading"><Loader2 :size="26" class="spin" /></div>
        <p v-else-if="!builds.length" class="cm-empty">No rosters published yet — be the first!</p>
        <div v-else class="cm-list">
          <div v-for="b in builds" :key="b.id" class="cm-card">
            <div class="cm-card-info">
              <span class="cm-card-title">{{ b.title }}</span>
              <span class="cm-card-meta">
                by {{ b.author ?? 'Unknown' }} · {{ b.player_count }} players ·
                {{ fmtSize(b.size_bytes) }} · {{ b.downloads }} downloads
              </span>
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
                {{ downloadedIds.has(b.id) ? 'Saved' : 'Download' }}
              </button>
              <button class="cm-ghost" title="Report this roster" @click="reportBuild(b)">
                <Flag :size="13" />
              </button>
            </div>
          </div>
        </div>
        <div v-if="lastPage > 1" class="cm-pager">
          <button class="cm-ghost" :disabled="page <= 1" @click="page--; fetchBoard()">‹ Prev</button>
          <span>{{ page }} / {{ lastPage }}</span>
          <button class="cm-ghost" :disabled="page >= lastPage" @click="page++; fetchBoard()">Next ›</button>
        </div>
      </section>

      <!-- Publish -->
      <section v-else-if="tab === 'publish'" class="cm-publish">
        <p v-if="!customCampaigns.length" class="cm-empty">
          No custom-roster campaigns on this account yet — create one in the app
          with the Custom league-roster option, then publish it here.
        </p>
        <template v-else>
          <label class="cm-field">
            <span>Campaign</span>
            <select v-model="publishCampaignId" class="cm-select">
              <option value="" disabled>Choose a custom campaign…</option>
              <option v-for="c in customCampaigns" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </label>
          <label class="cm-field">
            <span>Title</span>
            <input v-model="publishTitle" maxlength="100" class="cm-input" placeholder="e.g. 2010s Golden Era Remix" />
          </label>
          <label class="cm-field">
            <span>Description (optional)</span>
            <textarea v-model="publishDescription" maxlength="1000" rows="3" class="cm-input"></textarea>
          </label>
          <label class="cm-ack">
            <input v-model="publishAck" type="checkbox" />
            <span>
              I confirm this roster is my own original content and does not use real
              players', teams', or other people's names or likenesses. I understand
              reported content may be removed.
            </span>
          </label>
          <button
            class="cm-primary lg"
            :disabled="!publishCampaignId || !publishTitle.trim() || !publishAck || publishing"
            @click="publish"
          >
            <Loader2 v-if="publishing" :size="15" class="spin" />
            <Upload v-else :size="15" />
            Publish to the Board
          </button>
        </template>
      </section>

      <!-- My Downloads -->
      <section v-else>
        <p v-if="!myDownloads.length" class="cm-empty">
          Nothing saved yet — download a roster from the board and it will show up
          in the app under "Start from Downloaded".
        </p>
        <div v-else class="cm-list">
          <div v-for="b in myDownloads" :key="b.id" class="cm-card">
            <div class="cm-card-info">
              <span class="cm-card-title">{{ b.title }}</span>
              <span class="cm-card-meta">by {{ b.author ?? 'Unknown' }} · {{ b.player_count }} players</span>
            </div>
            <span class="cm-saved-tag"><Check :size="13" /> Available in app</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.community {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 18px 80px;
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
