<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useVuelidate } from '@vuelidate/core'
import { required, minLength, helpers } from '@vuelidate/validators'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton, FormInput, Badge } from '@/components/ui'
import { ArrowLeft, Coins, Sparkles, Sun, Moon } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()

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
})
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
</script>

<template>
  <div class="profile-page">
    <div class="profile-container">
      <div class="profile-header">
        <router-link to="/dashboard" class="back-link">
          <ArrowLeft :size="18" />
          <span>Back to Dashboard</span>
        </router-link>
        <h1 class="profile-title">Profile Settings</h1>
      </div>

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
  background: linear-gradient(135deg, var(--color-primary), var(--color-tertiary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
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

/* Responsive */
@media (max-width: 480px) {
  .rewards-grid {
    grid-template-columns: 1fr;
  }
}
</style>
