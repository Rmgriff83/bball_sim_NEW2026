<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useVuelidate } from '@vuelidate/core'
import { required, minLength, helpers } from '@vuelidate/validators'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton, FormInput, Badge } from '@/components/ui'
import { ArrowLeft } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()
const user = computed(() => authStore.user)

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
  <div class="min-h-screen p-4">
    <div class="container max-w-2xl">
      <div class="mb-8">
        <router-link to="/dashboard" class="link flex items-center gap-2 mb-2">
          <ArrowLeft :size="20" />
          Back to Dashboard
        </router-link>
        <h1 class="h2 text-gradient">Profile Settings</h1>
      </div>

      <GlassCard padding="lg" class="mb-6" :hoverable="false">
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-full bg-gradient-to-r from-primary to-secondary flex items-center justify-center text-2xl font-bold">
            {{ user?.username?.[0]?.toUpperCase() || '?' }}
          </div>
          <div>
            <h2 class="h4">{{ user?.username }}</h2>
            <p class="text-secondary">{{ user?.email }}</p>
            <Badge v-if="user?.email_verified" variant="success" size="sm" class="mt-1">Verified</Badge>
            <Badge v-else variant="warning" size="sm" class="mt-1">Email not verified</Badge>
          </div>
        </div>
      </GlassCard>

      <GlassCard padding="lg" class="mb-6" :hoverable="false">
        <h3 class="h4 mb-4">Update Profile</h3>
        <div v-if="profileSuccess" class="mb-4 p-3 rounded bg-success/20 border border-success text-success text-sm">{{ profileSuccess }}</div>
        <div v-if="profileError" class="mb-4 p-3 rounded bg-error/20 border border-error text-error text-sm">{{ profileError }}</div>
        <form @submit.prevent="handleProfileUpdate">
          <FormInput v-model="profileForm.username" label="Username" :error="v$Profile.username.$errors[0]?.$message"
            :touched="v$Profile.username.$dirty" required @blur="v$Profile.username.$touch()" />
          <BaseButton type="submit" variant="primary" :loading="authStore.loading">Save Changes</BaseButton>
        </form>
      </GlassCard>

      <GlassCard padding="lg" class="mb-6" :hoverable="false">
        <h3 class="h4 mb-4">Change Password</h3>
        <div v-if="passwordSuccess" class="mb-4 p-3 rounded bg-success/20 border border-success text-success text-sm">{{ passwordSuccess }}</div>
        <div v-if="passwordError" class="mb-4 p-3 rounded bg-error/20 border border-error text-error text-sm">{{ passwordError }}</div>
        <form @submit.prevent="handlePasswordUpdate">
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
      </GlassCard>

      <GlassCard padding="lg" :hoverable="false">
        <h3 class="h4 mb-4">Session</h3>
        <BaseButton variant="danger" @click="handleLogout">Sign Out</BaseButton>
      </GlassCard>
    </div>
  </div>
</template>
