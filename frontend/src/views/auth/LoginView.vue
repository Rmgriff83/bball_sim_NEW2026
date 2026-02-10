<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useVuelidate } from '@vuelidate/core'
import { required, email, helpers } from '@vuelidate/validators'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton, FormInput } from '@/components/ui'
import { ArrowLeft, AlertCircle } from 'lucide-vue-next'

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
  <div class="auth-page">
    <div class="auth-container">
      <!-- Back Link -->
      <router-link to="/" class="back-link">
        <ArrowLeft :size="18" />
        <span>Back to Home</span>
      </router-link>

      <!-- Auth Card -->
      <GlassCard padding="xl" :hoverable="false" class="auth-card">
        <!-- Header -->
        <div class="auth-header">
          <h1 class="auth-title">Sign In</h1>
          <p class="auth-subtitle">Welcome back to BBALL SIM</p>
        </div>

        <!-- Error Message -->
        <div v-if="error" class="auth-error">
          <AlertCircle :size="16" />
          <span>{{ error }}</span>
        </div>

        <!-- Form -->
        <form @submit.prevent="handleSubmit" class="auth-form">
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
            placeholder="Enter your password"
            :error="v$.password.$errors[0]?.$message"
            :touched="v$.password.$dirty"
            required
            @blur="v$.password.$touch()"
          />

          <div class="form-extras">
            <router-link to="/forgot-password" class="forgot-link">
              Forgot password?
            </router-link>
          </div>

          <button type="submit" class="cosmic-btn-block" :disabled="authStore.loading">
            {{ authStore.loading ? 'Signing In...' : 'Sign In' }}
          </button>
        </form>

        <!-- Divider -->
        <div class="auth-divider">
          <span>or</span>
        </div>

        <!-- Footer -->
        <p class="auth-footer">
          Don't have an account?
          <router-link to="/register" class="auth-link">Create one</router-link>
        </p>
      </GlassCard>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
}

.auth-container {
  width: 100%;
  max-width: 420px;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  transition: color 0.2s ease;
}

.back-link:hover {
  color: var(--color-primary);
}

.auth-card {
  border-radius: var(--radius-2xl);
  padding: 1.5rem;
}

.auth-header {
  text-align: center;
  margin-bottom: 2rem;
}

.auth-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
  margin-bottom: 0.5rem;
}

.auth-subtitle {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
}

.auth-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1.5rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--radius-lg);
  color: #EF4444;
  font-size: 0.875rem;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0 0.55rem;
}

/* Cosmic button */
.cosmic-btn-block {
  width: 100%;
  padding: 0.875rem 1.5rem;
  font-size: 1rem;
  font-weight: 600;
  color: #1a1520;
  background: var(--gradient-cosmic);
  border: none;
  border-radius: var(--radius-xl);
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 0.75rem;
}

.cosmic-btn-block:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(255, 193, 37, 0.3);
}

.cosmic-btn-block:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.form-extras {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 1rem;
}

.forgot-link {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  transition: color 0.2s ease;
}

.forgot-link:hover {
  color: var(--color-primary);
}

.auth-divider {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin: 1.5rem 0;
}

.auth-divider::before,
.auth-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--glass-border);
}

.auth-divider span {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.auth-footer {
  text-align: center;
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.auth-link {
  color: var(--color-primary);
  font-weight: 500;
  transition: opacity 0.2s ease;
}

.auth-link:hover {
  opacity: 0.8;
}

/* Light Mode */
[data-theme="light"] .auth-error {
  background: rgba(239, 68, 68, 0.08);
}
</style>
