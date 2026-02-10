<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton } from '@/components/ui'
import { Gamepad2, BarChart3, Trophy, ChevronRight } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()

const isAuthenticated = computed(() => authStore.isAuthenticated)
</script>

<template>
  <div class="home-page">
    <!-- Hero Section -->
    <main class="hero-section">
      <!-- Animated gradient background -->
      <div class="hero-gradient-bg">
        <div class="gradient-orb orb-1"></div>
        <div class="gradient-orb orb-2"></div>
        <div class="gradient-orb orb-3"></div>
      </div>

      <div class="hero-content">
        <!-- Logo/Title -->
        <div class="hero-badge">BASKETBALL SIMULATION</div>
        <h1 class="hero-title">BBALL SIM</h1>
        <p class="hero-subtitle">
          Build your dynasty. Manage your roster. Chase championships.
        </p>

        <!-- CTA Buttons -->
        <div class="hero-actions">
          <template v-if="isAuthenticated">
            <button class="cosmic-btn" @click="router.push('/dashboard')">
              Go to Dashboard
              <ChevronRight :size="20" />
            </button>
          </template>
          <template v-else>
            <button class="cosmic-btn" @click="router.push('/register')">
              Start Playing
              <ChevronRight :size="20" />
            </button>
            <button class="signin-btn" @click="router.push('/login')">
              Sign In
            </button>
          </template>
        </div>
      </div>

      <!-- Retro Effects -->
      <div class="retro-grid"></div>
      <div class="scanlines"></div>
      <div class="vignette"></div>
    </main>

    <!-- Features Section -->
    <section class="features-section">
      <div class="features-container">
        <h2 class="features-title">The Ultimate Basketball Experience</h2>

        <div class="features-grid">
          <div class="feature-card">
            <div class="feature-icon">
              <Gamepad2 :size="28" />
            </div>
            <h3 class="feature-heading">Deep Simulation</h3>
            <p class="feature-description">
              Possession-by-possession gameplay with realistic player ratings, badge synergies, and dynamic play calling
            </p>
          </div>

          <div class="feature-card">
            <div class="feature-icon">
              <BarChart3 :size="28" />
            </div>
            <h3 class="feature-heading">Franchise Mode</h3>
            <p class="feature-description">
              Manage rosters, handle finances, make trades, and guide your team through multiple seasons
            </p>
          </div>

          <div class="feature-card">
            <div class="feature-icon">
              <Trophy :size="28" />
            </div>
            <h3 class="feature-heading">Build a Dynasty</h3>
            <p class="feature-description">
              Draft promising prospects, develop young talent, and compete for championships year after year
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="home-footer">
      <p>Basketball Simulator &copy; 2026</p>
    </footer>
  </div>
</template>

<style scoped>
.home-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Hero Section */
.hero-section {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4rem 1.5rem;
  position: relative;
  overflow: hidden;
}

/* Animated gradient background */
.hero-gradient-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.gradient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.6;
}

.orb-1 {
  width: 500px;
  height: 500px;
  background: rgba(232, 90, 79, 0.4);
  top: 10%;
  left: 10%;
  animation: float1 12s ease-in-out infinite;
}

.orb-2 {
  width: 400px;
  height: 400px;
  background: rgba(255, 193, 37, 0.35);
  top: 50%;
  right: 10%;
  animation: float2 14s ease-in-out infinite;
}

.orb-3 {
  width: 450px;
  height: 450px;
  background: rgba(147, 51, 234, 0.3);
  bottom: 10%;
  left: 40%;
  animation: float3 16s ease-in-out infinite;
}

@keyframes float1 {
  0%, 100% {
    transform: translate(0, 0);
  }
  33% {
    transform: translate(15%, 20%);
  }
  66% {
    transform: translate(5%, -10%);
  }
}

@keyframes float2 {
  0%, 100% {
    transform: translate(0, 0);
  }
  33% {
    transform: translate(-20%, -15%);
  }
  66% {
    transform: translate(-10%, 10%);
  }
}

@keyframes float3 {
  0%, 100% {
    transform: translate(0, 0);
  }
  33% {
    transform: translate(-10%, -20%);
  }
  66% {
    transform: translate(15%, -5%);
  }
}

/* Cosmic button */
.cosmic-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 1.75rem;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #1a1520;
  background: var(--gradient-cosmic);
  border: none;
  border-radius: var(--radius-xl);
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 0 20px rgba(255, 193, 37, 0.3);
}

.cosmic-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 0 30px rgba(255, 193, 37, 0.5), 0 8px 24px rgba(255, 193, 37, 0.3);
}

.signin-btn {
  padding: 0.875rem 1.75rem;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-primary);
  background: transparent;
  border: 2px solid var(--color-text-primary);
  border-radius: var(--radius-xl);
  cursor: pointer;
  transition: all 0.2s ease;
}

.signin-btn:hover {
  background: var(--color-text-primary);
  color: var(--color-bg-primary);
  transform: translateY(-2px);
}

.hero-content {
  text-align: center;
  max-width: 700px;
  position: relative;
  z-index: 1;
}

.hero-badge {
  display: inline-block;
  padding: 0.5rem 1rem;
  background: #000;
  border: 1px solid rgba(255, 193, 37, 0.5);
  border-radius: var(--radius-full);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: #FFC125;
  margin-bottom: 1.5rem;
  text-transform: uppercase;
  box-shadow: 0 0 20px rgba(255, 193, 37, 0.15);
}

.hero-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: clamp(4rem, 12vw, 8rem);
  font-weight: 400;
  letter-spacing: 0.05em;
  line-height: 1;
  background: linear-gradient(135deg, var(--color-primary), var(--color-tertiary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 1rem;
  text-shadow: 0 0 40px rgba(232, 90, 79, 0.5);
  animation: textGlow 3s ease-in-out infinite;
}

@keyframes textGlow {
  0%, 100% {
    filter: drop-shadow(0 0 20px rgba(232, 90, 79, 0.4));
  }
  50% {
    filter: drop-shadow(0 0 30px rgba(255, 193, 37, 0.5));
  }
}

.hero-subtitle {
  font-size: 1.25rem;
  color: var(--color-text-secondary);
  max-width: 500px;
  margin: 0 auto 2.5rem;
  line-height: 1.6;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: center;
}

/* Retro grid */
.retro-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 60px 60px;
  pointer-events: none;
  mask-image: radial-gradient(ellipse at center, black 0%, transparent 70%);
  -webkit-mask-image: radial-gradient(ellipse at center, black 0%, transparent 70%);
}

/* Scanlines overlay */
.scanlines {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(100, 116, 139, 0.06) 2px,
    rgba(100, 116, 139, 0.06) 4px
  );
  pointer-events: none;
}

/* CRT vignette */
.vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(0, 0, 0, 0.4) 100%);
  pointer-events: none;
}

/* Features Section */
.features-section {
  padding: 4rem 1.5rem;
  background: var(--color-bg-secondary);
  border-top: 1px solid var(--glass-border);
}

.features-container {
  max-width: 1100px;
  margin: 0 auto;
}

.features-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.75rem;
  font-weight: 400;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-align: center;
  color: var(--color-text-primary);
  margin-bottom: 2.5rem;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
}

.feature-card {
  text-align: center;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 1.5rem;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  position: relative;
}

.feature-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--radius-2xl);
  padding: 1px;
  background: linear-gradient(135deg, transparent 40%, rgba(255, 193, 37, 0.3) 100%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.feature-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15), 0 0 30px rgba(255, 193, 37, 0.1);
}

.feature-card:hover::before {
  opacity: 1;
}

.feature-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gradient-cosmic);
  border-radius: var(--radius-xl);
  color: #1a1520;
}

.feature-heading {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.75rem;
}

.feature-description {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

/* Footer */
.home-footer {
  padding: 1.5rem;
  text-align: center;
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  border-top: 1px solid var(--glass-border);
}

/* Responsive */
@media (max-width: 640px) {
  .hero-section {
    padding: 3rem 1rem;
  }

  .hero-subtitle {
    font-size: 1rem;
  }

  .hero-actions {
    flex-direction: column;
    width: 100%;
    max-width: 280px;
    margin: 0 auto;
  }

  .features-section {
    padding: 3rem 1rem;
  }
}
</style>
