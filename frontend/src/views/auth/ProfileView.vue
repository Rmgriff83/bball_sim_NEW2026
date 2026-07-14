<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useVuelidate } from '@vuelidate/core'
import { required, minLength, helpers } from '@vuelidate/validators'
import { Capacitor } from '@capacitor/core'
import { useAuthStore } from '@/stores/auth'
import { useSyncStore } from '@/stores/sync'
import { useToastStore } from '@/stores/toast'
import { GlassCard, BaseButton, FormInput, Badge, BaseModal } from '@/components/ui'
import ConnectedAccounts from '@/components/auth/ConnectedAccounts.vue'
import { ArrowLeft, Coins, Sparkles, Sun, Moon, Cloud, CloudUpload, CloudDownload, Trash2, AlertTriangle, Zap, Users, Volume2, VolumeX, RotateCcw, Check, Bell } from 'lucide-vue-next'
import { useAudioStore } from '@/stores/audio'
import { useLocalCache } from '@/composables/useLocalCache'
import { useBadgeSynergies } from '@/composables/useBadgeSynergies'
import * as iap from '@/services/iap'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const syncStore = useSyncStore()
const toastStore = useToastStore()
const localCache = useLocalCache()
const { synergies, loadSynergies } = useBadgeSynergies()

const isNative = Capacitor.isNativePlatform()
const restoringPurchases = ref(false)

// Features unlocked via one-time IAP — currently just headshot_editor.
// Displayed in the Purchases section so the user can see what they own
// without going to /store.
const unlockedFeatureCatalog = [
  { id: 'headshot_editor', label: 'Headshot Editor' }
]

const ownedFeatures = computed(() =>
  unlockedFeatureCatalog.filter(f => authStore.hasFeature(f.id))
)

async function handleRestorePurchases() {
  if (restoringPurchases.value) return
  restoringPurchases.value = true
  try {
    if (isNative) {
      const result = await iap.restorePurchases()
      if (result.cancelled) return
      if (!result.success) {
        toastStore.showError('Could not restore purchases.')
        return
      }
    }
    try {
      await authStore.fetchUser()
    } catch {}
    toastStore.showSuccess('Purchases restored.')
  } finally {
    restoringPurchases.value = false
  }
}

// Tab navigation — honor a ?tab= deep link (e.g. the badge-synergy walkthrough
// link points here at the Database tab).
const validTabs = ['settings', 'database']
const activeTab = ref(validTabs.includes(route.query?.tab) ? route.query.tab : 'settings')

// Clear cache modal
const showClearCacheModal = ref(false)
const clearingCache = ref(false)

// Pull from cloud modal
const showPullFromCloudModal = ref(false)
const pullingFromCloud = ref(false)

// Delete account modal — Apple requires a destructive, clearly-worded
// confirmation. We also require the password (backend validates it) and that
// the user types DELETE, so an accidental tap can't wipe their account.
const showDeleteAccountModal = ref(false)
const deletingAccount = ref(false)
const deleteAccountPassword = ref('')
const deleteAccountConfirmText = ref('')
const deleteAccountError = ref('')
const canDeleteAccount = computed(
  () => deleteAccountPassword.value.length > 0 && deleteAccountConfirmText.value.trim().toUpperCase() === 'DELETE'
)

function closeDeleteAccountModal() {
  showDeleteAccountModal.value = false
  deleteAccountPassword.value = ''
  deleteAccountConfirmText.value = ''
  deleteAccountError.value = ''
}

// Theme toggle
const isDarkMode = ref(document.documentElement.getAttribute('data-theme') !== 'light')

function toggleTheme() {
  isDarkMode.value = !isDarkMode.value
  const theme = isDarkMode.value ? 'dark' : 'light'
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('theme', theme)
}

// Sound settings
const audio = useAudioStore()

function toggleSound() {
  // The global click listener taps this button; turning ON before it fires
  // means the tap plays as feedback, turning OFF silences it. No explicit call.
  audio.setEnabled(!audio.enabled)
}

function onVolumeInput(e) {
  audio.setVolume(Number(e.target.value) / 100)
}

function previewVolume() {
  audio.navigate() // play a sample after the user finishes dragging
}

// Notification reminders (native only). Status drives the row: 'prompt' can
// still fire the OS ask directly; 'denied' can only deep-link to system
// settings; 'granted' just shows On. Re-checked whenever the app regains
// visibility so returning from the Settings app updates the row in place.
const notifStatus = ref('unsupported')

async function refreshNotifStatus() {
  const { getPermissionStatus } = await import('@/services/notifications')
  notifStatus.value = await getPermissionStatus()
}

async function handleEnableReminders() {
  const n = await import('@/services/notifications')
  if (notifStatus.value === 'denied') {
    await n.openNotificationSettings()
  } else {
    await n.ensurePermission()
  }
  await refreshNotifStatus()
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') refreshNotifStatus()
}

// Which build is this device actually running? Native builds show
// "v<versionName> (<build>)" at the bottom of Settings — indispensable when
// diagnosing store-update / stale-asset issues.
const appVersion = ref('')

async function loadAppVersion() {
  try {
    const { App } = await import('@capacitor/app')
    const info = await App.getInfo()
    appVersion.value = `v${info.version} (${info.build})`
  } catch { /* label just stays hidden */ }
}

// Fetch fresh user data on mount to get latest rewards
onMounted(async () => {
  if (isNative) {
    refreshNotifStatus()
    loadAppVersion()
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  await authStore.fetchUser()
  loadSynergies()
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

// Badge synergy database helpers
const SYNERGY_CATEGORIES = {
  pick_and_roll: 'Pick & Roll',
  shooting: 'Shooting',
  defense: 'Defense',
  rebounding: 'Rebounding',
  playmaking: 'Playmaking',
  finishing: 'Finishing',
  leadership: 'Leadership',
  screen: 'Screen',
}

const BADGE_CATEGORIES = {
  pick_and_roll_maestro: 'pick_and_roll', brick_wall: 'screen',
  lob_city_finisher: 'finishing', lob_city_passer: 'playmaking',
  dimer: 'shooting', catch_and_shoot: 'shooting',
  floor_general: 'leadership', corner_specialist: 'shooting',
  defensive_leader: 'defense', rim_protector: 'defense',
  clamps: 'defense', interceptor: 'defense', break_starter: 'defense',
  rebound_chaser: 'rebounding', box: 'rebounding',
  putback_boss: 'rebounding', worm: 'rebounding',
  ankle_breaker: 'playmaking', space_creator: 'playmaking',
  needle_threader: 'playmaking', slithery_finisher: 'finishing',
  contact_finisher: 'finishing', posterizer: 'finishing',
  giant_slayer: 'finishing', floater_specialist: 'finishing',
  pick_dodger: 'screen',
}

function getSynergyCategory(syn) {
  // Try to derive from badge IDs
  const cat1 = BADGE_CATEGORIES[syn.badge1_id]
  const cat2 = BADGE_CATEGORIES[syn.badge2_id]
  // Prefer synergy-specific mapping based on name patterns
  const name = (syn.synergy_name || '').toLowerCase()
  if (name.includes('pick') && name.includes('roll')) return 'pick_and_roll'
  if (name.includes('alley') || name.includes('lob')) return 'pick_and_roll'
  if (name.includes('screen')) return 'screen'
  if (name.includes('leader')) return 'leadership'
  return cat1 || cat2 || 'shooting'
}

const groupedSynergies = computed(() => {
  const groups = {}
  for (const syn of synergies.value) {
    const cat = getSynergyCategory(syn)
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(syn)
  }
  // Return as sorted array of { category, label, synergies }
  return Object.entries(SYNERGY_CATEGORIES)
    .filter(([key]) => groups[key]?.length > 0)
    .map(([key, label]) => ({ category: key, label, synergies: groups[key] }))
})

function formatBadgeName(badgeId) {
  if (!badgeId) return ''
  return badgeId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function getLevelColor(level) {
  const colors = { bronze: '#CD7F32', silver: '#C0C0C0', gold: '#FFD700', hof: '#9B59B6' }
  return colors[level] || '#888'
}

function formatLevelLabel(level) {
  if (level === 'hof') return 'HOF'
  return level ? level.charAt(0).toUpperCase() + level.slice(1) : ''
}

function formatEffectBoosts(effect) {
  if (!effect?.boost) return []
  return Object.entries(effect.boost).map(([key, value]) => {
    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
    const formatted = typeof value === 'number' && value < 1
      ? `+${Math.round(value * 100)}%`
      : `+${value}`
    return `${formatted} ${label}`
  })
}
const user = computed(() => authStore.user)
const profile = computed(() => authStore.profile)

const profileForm = ref({ username: user.value?.username || '' })
const passwordForm = ref({ current_password: '', password: '', password_confirmation: '' })
const profileError = ref('')
const profileSuccess = ref('')
const passwordError = ref('')
const passwordSuccess = ref('')

const validUsername = helpers.regex(/^[a-zA-Z0-9_]+$/)

const profileRules = computed(() => ({
  username: {
    required: helpers.withMessage('Username is required', required),
    minLength: helpers.withMessage('Username must be at least 3 characters', minLength(3)),
    validUsername: helpers.withMessage('Username can only contain letters, numbers, and underscores', validUsername)
  }
}))

const passwordRules = computed(() => ({
  current_password: { required: helpers.withMessage('Current password is required', required) },
  password: {
    required: helpers.withMessage('New password is required', required),
    minLength: helpers.withMessage('Password must be at least 8 characters', minLength(8))
  },
  password_confirmation: { required: helpers.withMessage('Please confirm your password', required) }
}))

const v$Profile = useVuelidate(profileRules, profileForm)
const v$Password = useVuelidate(passwordRules, passwordForm)

async function handleProfileUpdate() {
  profileError.value = ''
  profileSuccess.value = ''
  if (!(await v$Profile.value.$validate())) return
  try {
    await authStore.updateProfile({ username: profileForm.value.username })
    profileSuccess.value = 'Profile updated successfully!'
  } catch (err) {
    profileError.value = err.response?.data?.message || 'Failed to update profile.'
  }
}

async function handlePasswordUpdate() {
  passwordError.value = ''
  passwordSuccess.value = ''
  if (!(await v$Password.value.$validate())) return
  try {
    await authStore.updatePassword(passwordForm.value)
    passwordSuccess.value = 'Password updated successfully!'
    passwordForm.value = { current_password: '', password: '', password_confirmation: '' }
    v$Password.value.$reset()
  } catch (err) {
    passwordError.value = err.response?.data?.message || 'Failed to update password.'
  }
}

async function handleLogout() {
  await authStore.logout()
  router.push('/login')
}

async function saveToCloud() {
  await syncStore.syncNow()
}

async function pullFromCloud() {
  pullingFromCloud.value = true
  try {
    let campaignIds = []
    if (syncStore.activeCampaignId) {
      campaignIds = [syncStore.activeCampaignId]
    } else {
      // No active campaign this session — exactly the state of a user who
      // lost local data and is here to recover it. Pull every campaign the
      // server has for this account instead of silently doing nothing.
      const serverCampaigns = await syncStore.fetchServerCampaigns()
      campaignIds = (serverCampaigns || []).map(c => c.id)
    }

    if (campaignIds.length === 0) {
      showPullFromCloudModal.value = false
      return
    }

    let restored = 0
    let lastErr = null
    for (const id of campaignIds) {
      try {
        await syncStore.forcePullFromCloud(id)
        restored++
      } catch (err) {
        lastErr = err
        console.error(`Pull from cloud failed for campaign ${id}:`, err)
      }
    }

    if (restored > 0) {
      showPullFromCloudModal.value = false
      // Full reload so every Pinia store rehydrates from the now-replaced IndexedDB.
      window.location.reload()
    } else if (lastErr) {
      throw lastErr
    }
  } catch (err) {
    console.error('Pull from cloud failed:', err)
  } finally {
    pullingFromCloud.value = false
  }
}

async function handleDeleteAccount() {
  if (!canDeleteAccount.value) return
  deleteAccountError.value = ''
  deletingAccount.value = true
  try {
    await authStore.deleteAccount(deleteAccountPassword.value)
    closeDeleteAccountModal()
    router.push('/login')
  } catch (err) {
    deleteAccountError.value =
      err.response?.data?.message || 'Failed to delete account. Please check your password and try again.'
  } finally {
    deletingAccount.value = false
  }
}

async function clearLocalCache() {
  clearingCache.value = true
  try {
    await localCache.clearAll()
    showClearCacheModal.value = false
    // Reload the page to reset all stores
    window.location.reload()
  } catch (err) {
    console.error('Failed to clear cache:', err)
  } finally {
    clearingCache.value = false
  }
}
</script>

<template>
  <div class="profile-page">
    <div class="profile-container">
      <div class="profile-header">
        <router-link to="/dashboard" class="back-link">
          <ArrowLeft :size="18" />
          <span>Back to Dashboard</span>
        </router-link>
        <h1 class="profile-title">Profile</h1>
      </div>

      <!-- Tab Navigation -->
      <div class="tab-nav">
        <button class="tab-btn" :class="{ active: activeTab === 'settings' }" @click="activeTab = 'settings'">
          Settings
        </button>
        <button class="tab-btn" :class="{ active: activeTab === 'database' }" @click="activeTab = 'database'">
          Database
        </button>
      </div>

      <!-- Settings Tab -->
      <div v-show="activeTab === 'settings'">

      <!-- User Info Card -->
      <div class="profile-section">
        <div class="user-info">
          <div class="user-avatar">
            {{ user?.username?.[0]?.toUpperCase() || '?' }}
          </div>
          <div class="user-details">
            <h2 class="user-name">{{ user?.username }}</h2>
            <p class="user-email">{{ user?.email }}</p>
          </div>
        </div>
      </div>

      <!-- Theme Toggle Card -->
      <div class="profile-section">
        <h3 class="section-title">Appearance</h3>
        <div class="theme-toggle-row">
          <div class="theme-label">
            <component :is="isDarkMode ? Moon : Sun" :size="20" />
            <span>{{ isDarkMode ? 'Dark Mode' : 'Light Mode' }}</span>
          </div>
          <button class="theme-toggle-btn" @click="toggleTheme" :class="{ active: isDarkMode }">
            <span class="toggle-track">
              <span class="toggle-thumb"></span>
            </span>
          </button>
        </div>
      </div>

      <!-- Sound Card -->
      <div class="profile-section">
        <h3 class="section-title">Sound</h3>
        <div class="theme-toggle-row">
          <div class="theme-label">
            <component :is="audio.enabled ? Volume2 : VolumeX" :size="20" />
            <span>{{ audio.enabled ? 'Sound On' : 'Sound Off' }}</span>
          </div>
          <button class="theme-toggle-btn" @click="toggleSound" :class="{ active: audio.enabled }">
            <span class="toggle-track">
              <span class="toggle-thumb"></span>
            </span>
          </button>
        </div>
        <div v-if="audio.enabled" class="volume-row">
          <span class="volume-label">Volume</span>
          <input
            type="range"
            min="0"
            max="100"
            :value="Math.round(audio.volume * 100)"
            class="volume-slider"
            @input="onVolumeInput"
            @change="previewVolume"
          />
          <span class="volume-value">{{ Math.round(audio.volume * 100) }}%</span>
        </div>
      </div>

      <!-- Notifications Card (native only — reminders are device-local).
           Always rendered on native, even when the plugin is unavailable:
           a silently-broken state must be VISIBLE, not vanish. -->
      <div v-if="isNative" class="profile-section">
        <h3 class="section-title">Notifications</h3>
        <div class="theme-toggle-row">
          <div class="theme-label">
            <Bell :size="20" />
            <span>Reminders</span>
          </div>
          <span v-if="notifStatus === 'granted'" class="notif-on-tag">
            <Check :size="14" /> On
          </span>
          <span v-else-if="notifStatus === 'unsupported'" class="notif-unavailable-tag">
            Unavailable
          </span>
          <button v-else class="notif-enable-btn" @click="handleEnableReminders">
            {{ notifStatus === 'denied' ? 'Open Settings' : 'Turn On' }}
          </button>
        </div>
        <p class="notif-hint">
          <template v-if="notifStatus === 'denied'">
            Notifications are turned off for this app in your device settings. Open Settings to
            allow them and get training and game-day reminders.
          </template>
          <template v-else-if="notifStatus === 'unsupported'">
            Notifications aren't available on this build.
          </template>
          <template v-else>
            Get an alert when a training session finishes, plus reminders when upgrade points or
            your next game are waiting.
          </template>
        </p>
      </div>

      <!-- Rewards Card -->
      <div class="profile-section">
        <h3 class="section-title">Rewards</h3>
        <div class="rewards-grid">
          <div class="reward-item">
            <div class="reward-icon tokens">
              <Coins :size="20" />
            </div>
            <div class="reward-info">
              <p class="reward-value">{{ profile?.tokens ?? 0 }}</p>
              <p class="reward-label">Tokens</p>
            </div>
          </div>
          <div class="reward-item">
            <div class="reward-icon synergies">
              <Sparkles :size="20" />
            </div>
            <div class="reward-info">
              <p class="reward-value">{{ profile?.lifetime_synergies ?? 0 }}</p>
              <p class="reward-label">Synergies</p>
            </div>
          </div>
        </div>
        <p class="reward-hint">Earn tokens when your team's badge synergies activate during games.</p>
      </div>

      <!-- Purchases Card -->
      <div class="profile-section">
        <h3 class="section-title">Purchases</h3>
        <div v-if="ownedFeatures.length > 0" class="owned-features-list">
          <div
            v-for="feature in ownedFeatures"
            :key="feature.id"
            class="owned-feature-row"
          >
            <Check :size="16" class="owned-feature-check" />
            <span class="owned-feature-label">{{ feature.label }}</span>
            <span class="owned-feature-tag">Owned</span>
          </div>
        </div>
        <p v-else class="purchases-empty">
          No one-time unlocks yet — browse the store to add features.
        </p>
        <p class="purchases-hint">
          If you previously purchased a feature on this Apple ID and don't see it here, tap Restore Purchases.
        </p>
        <BaseButton
          variant="secondary"
          @click="handleRestorePurchases"
          :loading="restoringPurchases"
          class="restore-button"
        >
          <RotateCcw :size="16" />
          Restore Purchases
        </BaseButton>
      </div>

      <!-- Data & Sync Card -->
      <div class="profile-section">
        <h3 class="section-title">Data & Sync</h3>
        <div class="sync-status-row">
          <div class="sync-info">
            <Cloud :size="20" />
            <span>{{ syncStore.lastSyncText }}</span>
          </div>
          <span v-if="syncStore.hasPendingChanges" class="pending-badge">Unsaved</span>
        </div>
        <div class="sync-buttons">
          <BaseButton
            variant="primary"
            @click="saveToCloud"
            :loading="syncStore.isSyncing"
            class="sync-button"
          >
            <CloudUpload :size="16" />
            Save to Cloud
          </BaseButton>
          <BaseButton
            variant="secondary"
            @click="showPullFromCloudModal = true"
            :loading="syncStore.isPulling"
            :disabled="!syncStore.activeCampaignId"
            class="sync-button"
          >
            <CloudDownload :size="16" />
            Pull from Cloud
          </BaseButton>
          <BaseButton
            variant="ghost"
            @click="showClearCacheModal = true"
            class="clear-cache-button"
          >
            <Trash2 :size="16" />
            Clear Local Cache
          </BaseButton>
        </div>
      </div>

      <!-- Pull from Cloud Confirmation Modal -->
      <BaseModal :show="showPullFromCloudModal" @close="showPullFromCloudModal = false" title="Pull from Cloud?">
        <div class="clear-cache-modal">
          <div class="warning-icon">
            <AlertTriangle :size="32" />
          </div>
          <p class="warning-text">
            This will replace all local campaign data with the version stored in the cloud.
          </p>
          <ul class="warning-list">
            <li>Any unsaved local changes will be lost permanently</li>
            <li>Use this to recover after switching devices or if local state is out of sync</li>
            <li>The page will reload once the pull completes</li>
          </ul>
          <p class="warning-hint">
            If you've made changes you want to keep, click "Save to Cloud" first and use this only on the device you want to sync TO.
          </p>
          <div class="modal-actions">
            <BaseButton variant="ghost" @click="showPullFromCloudModal = false">
              Cancel
            </BaseButton>
            <BaseButton variant="danger" @click="pullFromCloud" :loading="pullingFromCloud">
              <CloudDownload :size="16" />
              Overwrite Local Data
            </BaseButton>
          </div>
        </div>
      </BaseModal>

      <!-- Clear Cache Confirmation Modal -->
      <BaseModal :show="showClearCacheModal" @close="showClearCacheModal = false" title="Clear Local Cache?">
        <div class="clear-cache-modal">
          <div class="warning-icon">
            <AlertTriangle :size="32" />
          </div>
          <p class="warning-text">
            This will delete all locally stored game data from this browser.
          </p>
          <ul class="warning-list">
            <li>Any unsaved changes will be lost permanently</li>
            <li>Your data will be restored from the cloud on next load</li>
            <li>Use this if you're experiencing sync issues or corrupted data</li>
          </ul>
          <p class="warning-hint">
            Make sure to "Save to Cloud" first if you have unsaved changes you want to keep.
          </p>
          <div class="modal-actions">
            <BaseButton variant="ghost" @click="showClearCacheModal = false">
              Cancel
            </BaseButton>
            <BaseButton variant="danger" @click="clearLocalCache" :loading="clearingCache">
              <Trash2 :size="16" />
              Clear Cache
            </BaseButton>
          </div>
        </div>
      </BaseModal>

      <!-- Connected Accounts (Apple/Google linking) -->
      <ConnectedAccounts />

      <!-- Update Profile Card -->
      <div class="profile-section">
        <h3 class="section-title">Update Profile</h3>
        <div v-if="profileSuccess" class="form-message success">{{ profileSuccess }}</div>
        <div v-if="profileError" class="form-message error">{{ profileError }}</div>
        <form @submit.prevent="handleProfileUpdate" class="profile-form">
          <FormInput v-model="profileForm.username" label="Username" :error="v$Profile.username.$errors[0]?.$message"
            :touched="v$Profile.username.$dirty" required @blur="v$Profile.username.$touch()" />
          <BaseButton type="submit" variant="primary" :loading="authStore.loading">Save Changes</BaseButton>
        </form>
      </div>

      <!-- Change Password Card -->
      <div class="profile-section">
        <h3 class="section-title">Change Password</h3>
        <div v-if="passwordSuccess" class="form-message success">{{ passwordSuccess }}</div>
        <div v-if="passwordError" class="form-message error">{{ passwordError }}</div>
        <form @submit.prevent="handlePasswordUpdate" class="profile-form">
          <FormInput v-model="passwordForm.current_password" label="Current Password" type="password"
            :error="v$Password.current_password.$errors[0]?.$message" :touched="v$Password.current_password.$dirty" required
            @blur="v$Password.current_password.$touch()" />
          <FormInput v-model="passwordForm.password" label="New Password" type="password"
            :error="v$Password.password.$errors[0]?.$message" :touched="v$Password.password.$dirty" required
            @blur="v$Password.password.$touch()" />
          <FormInput v-model="passwordForm.password_confirmation" label="Confirm New Password" type="password"
            :error="v$Password.password_confirmation.$errors[0]?.$message" :touched="v$Password.password_confirmation.$dirty" required
            @blur="v$Password.password_confirmation.$touch()" />
          <BaseButton type="submit" variant="primary" :loading="authStore.loading">Update Password</BaseButton>
        </form>
      </div>

      <!-- Admin Tools — only rendered for users with global_admin = true.
           Same dev-only caveat applies as the backend tier endpoint: the
           page renders in any environment but the file-mutation actions
           require FRONTEND_ASSETS_PATH to be set locally. -->
      <div v-if="authStore.isGlobalAdmin" class="profile-section">
        <h3 class="section-title">Admin Tools</h3>
        <BaseButton variant="secondary" @click="router.push('/admin/headshots')">
          Open Headshot Forge
        </BaseButton>
      </div>

      <!-- Session Card -->
      <div class="profile-section">
        <h3 class="section-title">Session</h3>
        <BaseButton variant="danger" @click="handleLogout">Sign Out</BaseButton>
      </div>

      <!-- Danger Zone Card -->
      <div class="profile-section danger-zone">
        <h3 class="section-title">Delete Account</h3>
        <p class="danger-zone-desc">
          Permanently delete your account and all of its data. This cannot be undone.
        </p>
        <BaseButton variant="danger" @click="showDeleteAccountModal = true" class="delete-account-button">
          <Trash2 :size="16" />
          Delete Account
        </BaseButton>
      </div>

      <!-- Delete Account Confirmation Modal -->
      <BaseModal :show="showDeleteAccountModal" @close="closeDeleteAccountModal" title="Delete Account?">
        <div class="clear-cache-modal">
          <div class="warning-icon">
            <AlertTriangle :size="32" />
          </div>
          <p class="warning-text">
            This will permanently delete your account. This action <strong>cannot be undone.</strong>
          </p>
          <ul class="warning-list">
            <li>Your profile, username, and login will be erased</li>
            <li>All of your campaigns and saved game data will be deleted</li>
            <li>Your tokens, rewards, and synergy progress will be lost forever</li>
            <li>This data cannot be recovered — there is no going back</li>
          </ul>
          <p class="warning-hint">
            If you're sure, enter your password and type DELETE to confirm.
          </p>
          <div v-if="deleteAccountError" class="form-message error">{{ deleteAccountError }}</div>
          <div class="delete-confirm-fields">
            <FormInput
              v-model="deleteAccountPassword"
              label="Password"
              type="password"
              placeholder="Enter your password"
            />
            <FormInput
              v-model="deleteAccountConfirmText"
              label="Type DELETE to confirm"
              placeholder="DELETE"
            />
          </div>
          <div class="modal-actions">
            <BaseButton variant="ghost" @click="closeDeleteAccountModal">
              Cancel
            </BaseButton>
            <BaseButton
              variant="danger"
              @click="handleDeleteAccount"
              :loading="deletingAccount"
              :disabled="!canDeleteAccount"
            >
              <Trash2 :size="16" />
              Delete My Account
            </BaseButton>
          </div>
        </div>
      </BaseModal>

      <!-- Build identifier — which binary + bundle this device is actually
           running. Native only (appVersion stays empty on web). -->
      <p v-if="appVersion" class="app-version-label">BBALL SIM {{ appVersion }}</p>

      </div><!-- end Settings Tab -->

      <!-- Database Tab -->
      <div v-show="activeTab === 'database'">
        <div class="profile-section">
          <h3 class="section-title">Badge Synergies</h3>
          <p class="db-description">When two players in your lineup each have matching synergy badges, a synergy activates and provides bonus effects during games. The boost scales with badge level — higher levels mean stronger synergies.</p>
        </div>

        <div v-for="group in groupedSynergies" :key="group.category" class="synergy-category-section">
          <h4 class="synergy-category-title">{{ group.label }}</h4>
          <div class="synergy-database-grid">
            <div v-for="syn in group.synergies" :key="syn.id" class="synergy-card">
              <div class="synergy-card-header">
                <Zap :size="16" class="synergy-zap-icon" />
                <span class="synergy-card-name">{{ syn.synergy_name }}</span>
              </div>
              <p class="synergy-card-desc">{{ syn.description }}</p>
              <div class="synergy-badges-row">
                <div class="synergy-badge-req">
                  <span class="synergy-badge-name">{{ formatBadgeName(syn.badge1_id) }}</span>
                </div>
                <span class="synergy-plus">+</span>
                <div class="synergy-badge-req">
                  <span class="synergy-badge-name">{{ formatBadgeName(syn.badge2_id) }}</span>
                </div>
              </div>
              <div class="synergy-effects">
                <span v-for="(boost, idx) in formatEffectBoosts(syn.effect)" :key="idx" class="synergy-effect-tag">
                  {{ boost }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <!-- Dynamic Duo Explanation -->
        <div class="profile-section" style="margin-top: 1.5rem;">
          <h3 class="section-title">
            <Users :size="18" style="color: #FFD700;" />
            Dynamic Duo
          </h3>
          <p class="db-description">When two players in your lineup share 2 or more synergies and both players have the involved badges at Gold level or higher, they form a <strong style="color: #FFD700;">Dynamic Duo</strong>. Each player in the duo receives a +2% boost to all attributes.</p>
          <div class="dynamic-duo-info-card">
            <div class="duo-requirements">
              <span class="duo-req-item">2+ matching synergies at Gold or higher</span>
              <span class="duo-req-item">+2% boost to all attributes for both players</span>
            </div>
          </div>
        </div>
      </div><!-- end Database Tab -->

    </div>
  </div>
</template>

<style scoped>
.profile-page {
  min-height: 100vh;
  padding: 2rem 1rem;
}

.profile-container {
  max-width: 640px;
  margin: 0 auto;
}

.profile-header {
  margin-bottom: 2rem;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  transition: color 0.2s ease;
}

.back-link:hover {
  color: var(--color-primary);
}

.profile-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
}

/* Section Cards */
.profile-section {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 1.5rem;
  margin-bottom: 1rem;
}

.section-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 1rem;
}

/* User Info */
.user-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.user-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--gradient-cosmic);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 700;
  color: #1a1520;
  flex-shrink: 0;
}

.user-name {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.25rem;
}

.user-email {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

/* Theme Toggle */
.theme-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* Volume slider */
.volume-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1rem;
}

.volume-label {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.volume-slider {
  flex: 1;
  accent-color: var(--color-primary);
  cursor: pointer;
}

.volume-value {
  font-size: 0.875rem;
  color: var(--color-text-primary);
  min-width: 2.75rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.theme-label {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--color-text-primary);
  font-weight: 500;
}

.theme-toggle-btn {
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
}

.toggle-track {
  display: block;
  width: 48px;
  height: 26px;
  background: var(--color-bg-tertiary);
  border-radius: 13px;
  position: relative;
  transition: background 0.2s ease;
}

.theme-toggle-btn.active .toggle-track {
  background: var(--color-primary);
}

.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s ease;
}

.theme-toggle-btn.active .toggle-thumb {
  transform: translateX(22px);
}

/* Light mode toggle contrast fix */
[data-theme="light"] .toggle-track {
  background: #d1d5db;
  border: 1px solid #9ca3af;
}

[data-theme="light"] .theme-toggle-btn.active .toggle-track {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

[data-theme="light"] .toggle-thumb {
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

/* Notifications */
.notif-on-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #22c55e;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.25);
  padding: 4px 10px;
  border-radius: 20px;
}

.notif-enable-btn {
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: var(--radius-lg);
  font-size: 0.8rem;
  font-weight: 600;
  padding: 8px 14px;
  cursor: pointer;
  transition: filter 0.2s ease;
}

.notif-enable-btn:hover {
  filter: brightness(1.1);
}

.notif-hint {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  line-height: 1.5;
  margin-top: 0.75rem;
}

.notif-unavailable-tag {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  padding: 4px 10px;
  border-radius: 20px;
}

.app-version-label {
  text-align: center;
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  letter-spacing: 0.05em;
  margin: 0.5rem 0 1rem;
}

/* Rewards */
.rewards-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.reward-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--radius-lg);
}

[data-theme="light"] .reward-item {
  background: rgba(0, 0, 0, 0.05);
}

.reward-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.reward-icon.tokens {
  background: rgba(234, 179, 8, 0.2);
  color: #EAB308;
}

.reward-icon.synergies {
  background: rgba(147, 51, 234, 0.2);
  color: #9333EA;
}

.reward-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.reward-label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.reward-hint {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}

/* Purchases */
.owned-features-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.owned-feature-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.75rem 0.875rem;
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.2);
  border-radius: var(--radius-lg);
}

.owned-feature-check {
  color: #22c55e;
  flex-shrink: 0;
}

.owned-feature-label {
  flex: 1;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

.owned-feature-tag {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #22c55e;
}

.purchases-empty {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin: 0 0 0.75rem;
}

.purchases-hint {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  margin: 0 0 1rem;
  line-height: 1.5;
}

.restore-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
}

/* Sync Status */
.sync-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.sync-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--color-text-secondary);
}

.pending-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.5rem;
  background: rgba(234, 179, 8, 0.2);
  color: #EAB308;
  border-radius: var(--radius-lg);
}

.sync-buttons {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.sync-button,
.clear-cache-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.clear-cache-button {
  color: var(--color-text-secondary);
}

.clear-cache-button:hover {
  color: var(--color-error);
}

/* Clear Cache Modal */
.clear-cache-modal {
  text-align: center;
}

.warning-icon {
  width: 64px;
  height: 64px;
  margin: 0 auto 1rem;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #EF4444;
}

.warning-text {
  font-size: 1rem;
  font-weight: 500;
  color: var(--color-text-primary);
  margin-bottom: 1rem;
}

.warning-list {
  text-align: left;
  padding-left: 1.5rem;
  margin-bottom: 1rem;
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.warning-list li {
  margin-bottom: 0.5rem;
}

.warning-hint {
  font-size: 0.75rem;
  color: var(--color-warning);
  background: rgba(234, 179, 8, 0.1);
  padding: 0.75rem;
  border-radius: var(--radius-lg);
  margin-bottom: 1.5rem;
}

.modal-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
}

.modal-actions .btn {
  min-width: 120px;
}

/* Danger Zone */
.danger-zone {
  border-color: rgba(239, 68, 68, 0.3);
}

.danger-zone-desc {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin-bottom: 1rem;
}

.delete-account-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.delete-confirm-fields {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  text-align: left;
}

/* Forms */
.profile-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-message {
  padding: 0.75rem 1rem;
  border-radius: var(--radius-lg);
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.form-message.success {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #22C55E;
}

.form-message.error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #EF4444;
}

/* Tab Navigation */
.tab-nav {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid var(--glass-border);
  padding-bottom: 0;
}

.tab-btn {
  padding: 0.625rem 1.25rem;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.2s ease, border-color 0.2s ease;
  margin-bottom: -1px;
}

.tab-btn:hover {
  color: var(--color-text-primary);
}

.tab-btn.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

/* Database Tab */
.db-description {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.synergy-category-section {
  margin-bottom: 1.5rem;
}

.synergy-category-title {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary);
  margin-bottom: 0.75rem;
  padding-left: 0.25rem;
}

.synergy-database-grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.synergy-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 1rem;
}

.synergy-card-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.synergy-zap-icon {
  color: #00E5FF;
  flex-shrink: 0;
}

.synergy-card-name {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.synergy-card-desc {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
  line-height: 1.4;
}

.synergy-badges-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}

.synergy-badge-req {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
}

[data-theme="light"] .synergy-badge-req {
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.1);
}

.synergy-badge-name {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

.synergy-badge-level {
  font-size: 0.65rem;
  font-weight: 700;
}

.synergy-plus {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--color-text-tertiary);
}

.synergy-effects {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.synergy-effect-tag {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.2rem 0.5rem;
  background: rgba(0, 229, 255, 0.1);
  color: #00E5FF;
  border-radius: 4px;
}

.dynamic-duo-info-card {
  padding: 1rem;
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.1), rgba(255, 140, 0, 0.1));
  border: 1px solid rgba(255, 215, 0, 0.25);
  border-radius: 0.5rem;
  margin-top: 0.75rem;
}

.duo-requirements {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.duo-req-item {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  padding-left: 1rem;
  position: relative;
}

.duo-req-item::before {
  content: '\2605';
  position: absolute;
  left: 0;
  color: #FFD700;
}

/* Responsive */
@media (max-width: 480px) {
  .rewards-grid {
    grid-template-columns: 1fr;
  }

  .synergy-badges-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .synergy-plus {
    align-self: center;
  }
}

/* Cloud-sync confirmation modals (Pull from Cloud, Clear Local Cache) are
   short content-sized dialogs — opt them out of the standardized 90vh
   min-height applied to BaseModal so they don't render with awkward empty
   space below the action buttons. :deep() reaches into BaseModal's scoped
   .modal-container; only BaseModal usages within ProfileView are affected. */
:deep(.modal-container) {
  min-height: auto !important;
}
</style>
