<script setup>
import { ref, computed } from 'vue'
import { useVuelidate } from '@vuelidate/core'
import { required, email, helpers } from '@vuelidate/validators'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton, FormInput } from '@/components/ui'
import { ArrowLeft } from 'lucide-vue-next'

const authStore = useAuthStore()
const form = ref({ email: '' })
const error = ref('')
const success = ref(false)

const rules = computed(() => ({
  email: {
    required: helpers.withMessage('Email is required', required),
    email: helpers.withMessage('Please enter a valid email', email)
  }
}))

const v$ = useVuelidate(rules, form)

async function handleSubmit() {
  error.value = ''
  success.value = false
  if (!(await v$.value.$validate())) return

  try {
    await authStore.forgotPassword(form.value.email)
    success.value = true
  } catch (err) {
    error.value = err.response?.data?.message || 'Failed to send reset link.'
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <router-link to="/login" class="link flex items-center gap-2 mb-6">
        <ArrowLeft :size="20" />
        Back to Sign In
      </router-link>

      <GlassCard padding="lg" :hoverable="false">
        <h1 class="h2 text-gradient text-center mb-2">Reset Password</h1>
        <p class="text-secondary text-center mb-6">Enter your email and we'll send you a reset link</p>

        <div v-if="success" class="mb-4 p-3 rounded bg-success/20 border border-success text-success text-sm">
          Password reset link sent! Check your email.
        </div>
        <div v-if="error" class="mb-4 p-3 rounded bg-error/20 border border-error text-error text-sm">
          {{ error }}
        </div>

        <form v-if="!success" @submit.prevent="handleSubmit">
          <FormInput v-model="form.email" label="Email" type="email" placeholder="you@example.com"
            :error="v$.email.$errors[0]?.$message" :touched="v$.email.$dirty" required @blur="v$.email.$touch()" />
          <BaseButton type="submit" variant="primary" block :loading="authStore.loading">Send Reset Link</BaseButton>
        </form>

        <div v-else class="text-center">
          <BaseButton variant="secondary" @click="success = false; form.email = ''">Send Another Link</BaseButton>
        </div>
      </GlassCard>
    </div>
  </div>
</template>
