<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useVuelidate } from '@vuelidate/core'
import { required, minLength, helpers } from '@vuelidate/validators'
import { useAuthStore } from '@/stores/auth'
import { useSyncStore } from '@/stores/sync'
import { GlassCard, BaseButton, FormInput, Badge, BaseModal } from '@/components/ui'
import { ArrowLeft, Coins, Sparkles, Sun, Moon, Cloud, CloudUpload, Trash2, AlertTriangle, Zap, Users } from 'lucide-vue-next'
import { useLocalCache } from '@/composables/useLocalCache'
import { useBadgeSynergies } from '@/composables/useBadgeSynergies'

const router = useRouter()
const authStore = useAuthStore()
const syncStore = useSyncStore()
const localCache = useLocalCache()
const { synergies, loadSynergies } = useBadgeSynergies()

// Tab navigation
const activeTab = ref('settings')

// Clear cache modal
const showClearCacheModal = ref(false)
const clearingCache = ref(false)

// Theme toggle
const isDarkMode = ref(document.documentElement.getAttribute('data-theme') !== 'light')

function toggleTheme() {
  isDarkMode.value = !isDarkMode.value
  const theme = isDarkMode.value ? 'dark' : 'light'
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('theme', theme)
}

// Fetch fresh user data on mount to get latest rewards
onMounted(async () => {
  await authStore.fetchUser()
  loadSynergies()
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
            <Badge v-if="user?.email_verified" variant="success" size="sm" class="mt-1">Verified</Badge>
            <Badge v-else variant="warning" size="sm" class="mt-1">Email not verified</Badge>
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
            variant="ghost"
            @click="showClearCacheModal = true"
            class="clear-cache-button"
          >
            <Trash2 :size="16" />
            Clear Local Cache
          </BaseButton>
        </div>
      </div>

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

      <!-- Session Card -->
      <div class="profile-section">
        <h3 class="section-title">Session</h3>
        <BaseButton variant="danger" @click="handleLogout">Sign Out</BaseButton>
      </div>

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
</style>
