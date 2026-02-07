<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useVuelidate } from '@vuelidate/core'
import { required, minLength, sameAs, helpers } from '@vuelidate/validators'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton, FormInput } from '@/components/ui'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const form = ref({
  email: route.query.email || '',
  token: route.query.token || '',
  password: '',
  password_confirmation: ''
})

const error = ref('')
const success = ref(false)

const rules = computed(() => ({
  password: {
    required: helpers.withMessage('Password is required', required),
    minLength: helpers.withMessage('Password must be at least 8 characters', minLength(8))
  },
  password_confirmation: {
    required: helpers.withMessage('Please confirm your password', required),
    sameAs: helpers.withMessage('Passwords do not match', sameAs(computed(() => form.value.password)))
  }
}))

const v$ = useVuelidate(rules, form)

async function handleSubmit() {
  error.value = ''
  if (!(await v$.value.$validate())) return

  try {
    await authStore.resetPassword(form.value)
    success.value = true
  } catch (err) {
    error.value = err.response?.data?.message || 'Failed to reset password.'
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <GlassCard padding="lg" :hoverable="false">
        <h1 class="h2 text-gradient text-center mb-6">Set New Password</h1>

        <div v-if="success" class="text-center">
          <div class="mb-4 p-3 rounded bg-success/20 border border-success text-success text-sm">
            Password reset successfully!
          </div>
          <BaseButton variant="primary" @click="router.push('/login')">Go to Sign In</BaseButton>
        </div>

        <template v-else>
          <div v-if="error" class="mb-4 p-3 rounded bg-error/20 border border-error text-error text-sm">
            {{ error }}
          </div>

          <div v-if="!form.token" class="mb-4 p-3 rounded bg-warning/20 border border-warning text-warning text-sm">
            Invalid or missing reset token. Please request a new password reset link.
          </div>

          <form v-if="form.token" @submit.prevent="handleSubmit">
            <FormInput v-model="form.password" label="New Password" type="password" placeholder="••••••••"
              :error="v$.password.$errors[0]?.$message" :touched="v$.password.$dirty" required @blur="v$.password.$touch()" />

            <FormInput v-model="form.password_confirmation" label="Confirm New Password" type="password" placeholder="••••••••"
              :error="v$.password_confirmation.$errors[0]?.$message" :touched="v$.password_confirmation.$dirty" required
              @blur="v$.password_confirmation.$touch()" />

            <BaseButton type="submit" variant="primary" block :loading="authStore.loading">Reset Password</BaseButton>
          </form>

          <div v-else class="text-center">
            <BaseButton variant="secondary" @click="router.push('/forgot-password')">Request New Link</BaseButton>
          </div>
        </template>
      </GlassCard>
    </div>
  </div>
</template>
