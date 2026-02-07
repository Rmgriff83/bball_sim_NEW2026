<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useVuelidate } from '@vuelidate/core'
import { required, email, minLength, sameAs, helpers } from '@vuelidate/validators'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton, FormInput } from '@/components/ui'
import { ArrowLeft } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()

const form = ref({
  username: '',
  email: '',
  password: '',
  password_confirmation: ''
})

const error = ref('')
const validUsername = helpers.regex(/^[a-zA-Z0-9_]+$/)

const rules = computed(() => ({
  username: {
    required: helpers.withMessage('Username is required', required),
    minLength: helpers.withMessage('Username must be at least 3 characters', minLength(3)),
    validUsername: helpers.withMessage('Username can only contain letters, numbers, and underscores', validUsername)
  },
  email: {
    required: helpers.withMessage('Email is required', required),
    email: helpers.withMessage('Please enter a valid email', email)
  },
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
  const isValid = await v$.value.$validate()
  if (!isValid) return

  try {
    await authStore.register(form.value)
    router.push('/dashboard')
  } catch (err) {
    if (err.response?.data?.errors) {
      error.value = Object.values(err.response.data.errors).flat().join(' ')
    } else {
      error.value = err.response?.data?.message || 'Registration failed.'
    }
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <router-link to="/" class="link flex items-center gap-2 mb-6">
        <ArrowLeft :size="20" />
        Back to Home
      </router-link>

      <GlassCard padding="lg" :hoverable="false">
        <h1 class="h2 text-gradient text-center mb-6">Create Account</h1>

        <div v-if="error" class="mb-4 p-3 rounded bg-error/20 border border-error text-error text-sm">
          {{ error }}
        </div>

        <form @submit.prevent="handleSubmit">
          <FormInput v-model="form.username" label="Username" placeholder="your_username"
            :error="v$.username.$errors[0]?.$message" :touched="v$.username.$dirty" required @blur="v$.username.$touch()" />

          <FormInput v-model="form.email" label="Email" type="email" placeholder="you@example.com"
            :error="v$.email.$errors[0]?.$message" :touched="v$.email.$dirty" required @blur="v$.email.$touch()" />

          <FormInput v-model="form.password" label="Password" type="password" placeholder="••••••••"
            :error="v$.password.$errors[0]?.$message" :touched="v$.password.$dirty" required @blur="v$.password.$touch()" />

          <FormInput v-model="form.password_confirmation" label="Confirm Password" type="password" placeholder="••••••••"
            :error="v$.password_confirmation.$errors[0]?.$message" :touched="v$.password_confirmation.$dirty" required
            @blur="v$.password_confirmation.$touch()" />

          <BaseButton type="submit" variant="primary" block :loading="authStore.loading" class="mt-2">
            Create Account
          </BaseButton>
        </form>

        <div class="divider my-6"></div>

        <p class="text-center text-secondary text-sm">
          Already have an account?
          <router-link to="/login" class="link">Sign in</router-link>
        </p>
      </GlassCard>
    </div>
  </div>
</template>
