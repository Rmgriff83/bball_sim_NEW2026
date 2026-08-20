<script setup>
import { ref, computed } from 'vue'
import { useVuelidate } from '@vuelidate/core'
import { required, email, helpers } from '@vuelidate/validators'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton, FormInput } from '@/components/ui'
import { ArrowLeft } from 'lucide-vue-next'
import { t } from '@wl-i18n/i18n.js'

const authStore = useAuthStore()
const form = ref({ email: '' })
const error = ref('')
const success = ref(false)

// Rules live in a computed: t() reads the reactive locale ref, so these
// messages re-evaluate (and vuelidate rebuilds) on locale change — no freeze.
const rules = computed(() => ({
  email: {
    required: helpers.withMessage(t('Email is required'), required),
    email: helpers.withMessage(t('Please enter a valid email'), email)
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
    error.value = err.response?.data?.message || t('Failed to send reset link.')
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <router-link to="/login" class="link flex items-center gap-2 mb-6">
        <ArrowLeft :size="20" />
        {{ $t('Back to Sign In') }}
      </router-link>

      <GlassCard padding="lg" :hoverable="false">
        <h1 class="h2 text-gradient text-center mb-2">{{ $t('Reset Password') }}</h1>
        <p class="text-secondary text-center mb-6">{{ $t("Enter your email and we'll send you a reset link") }}</p>

        <div v-if="success" class="mb-4 p-3 rounded bg-success/20 border border-success text-success text-sm">
          {{ $t('Password reset link sent! Check your email.') }}
        </div>
        <div v-if="error" class="mb-4 p-3 rounded bg-error/20 border border-error text-error text-sm">
          {{ error }}
        </div>

        <form v-if="!success" @submit.prevent="handleSubmit">
          <FormInput v-model="form.email" :label="$t('Email')" type="email" :placeholder="$t('you@example.com')"
            :error="v$.email.$errors[0]?.$message" :touched="v$.email.$dirty" required @blur="v$.email.$touch()" />
          <BaseButton type="submit" variant="primary" block :loading="authStore.loading">{{ $t('Send Reset Link') }}</BaseButton>
        </form>

        <div v-else class="text-center">
          <BaseButton variant="secondary" @click="success = false; form.email = ''">{{ $t('Send Another Link') }}</BaseButton>
        </div>
      </GlassCard>
    </div>
  </div>
</template>
