<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useVuelidate } from '@vuelidate/core'
import { required, email, helpers } from '@vuelidate/validators'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton, FormInput } from '@/components/ui'
import { ArrowLeft } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const form = ref({
  email: '',
  password: ''
})

const error = ref('')

const rules = computed(() => ({
  email: {
    required: helpers.withMessage('Email is required', required),
    email: helpers.withMessage('Please enter a valid email', email)
  },
  password: {
    required: helpers.withMessage('Password is required', required)
  }
}))

const v$ = useVuelidate(rules, form)

async function handleSubmit() {
  error.value = ''
  const isValid = await v$.value.$validate()

  if (!isValid) return

  try {
    await authStore.login({
      email: form.value.email,
      password: form.value.password
    })

    const redirect = route.query.redirect || '/dashboard'
    router.push(redirect)
  } catch (err) {
    error.value = err.response?.data?.message || 'Login failed. Please try again.'
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
        <h1 class="h2 text-gradient text-center mb-6">Sign In</h1>

        <div v-if="error" class="mb-4 p-3 rounded bg-error/20 border border-error text-error text-sm">
          {{ error }}
        </div>

        <form @submit.prevent="handleSubmit">
          <FormInput
            v-model="form.email"
            label="Email"
            type="email"
            placeholder="you@example.com"
            :error="v$.email.$errors[0]?.$message"
            :touched="v$.email.$dirty"
            required
            @blur="v$.email.$touch()"
          />

          <FormInput
            v-model="form.password"
            label="Password"
            type="password"
            placeholder="••••••••"
            :error="v$.password.$errors[0]?.$message"
            :touched="v$.password.$dirty"
            required
            @blur="v$.password.$touch()"
          />

          <div class="flex justify-end mb-4">
            <router-link to="/forgot-password" class="link text-sm">
              Forgot password?
            </router-link>
          </div>

          <BaseButton type="submit" variant="primary" block :loading="authStore.loading">
            Sign In
          </BaseButton>
        </form>

        <div class="divider my-6"></div>

        <p class="text-center text-secondary text-sm">
          Don't have an account?
          <router-link to="/register" class="link">Sign up</router-link>
        </p>
      </GlassCard>
    </div>
  </div>
</template>
