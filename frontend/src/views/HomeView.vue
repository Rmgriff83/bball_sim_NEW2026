<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton } from '@/components/ui'
import { Gamepad2, BarChart3, Trophy, ChevronRight } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()

const isAuthenticated = computed(() => authStore.isAuthenticated)

// VITE_NATIVE_BUILD is set by `npm run build:ios`. The App Store badge
// only makes sense on the web build — inside the native app, users are
// already on iOS, so the link is redundant. Build-time env is preferable
// to a Capacitor.isNativePlatform() runtime check here because Vite
// tree-shakes the branch entirely from the iOS bundle.
const isNativeBuild = import.meta.env.VITE_NATIVE_BUILD
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
        <div class="hero-badge">DYNASTY BASKETBALL</div>
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

        <!-- App Store badge — web build only. Inline SVG so we're not
             hotlinking Apple's CDN; the design follows the official
             "Download on the App Store" badge spec. Native iOS users are
             already in the app, so VITE_NATIVE_BUILD strips this branch
             entirely from the iOS bundle. -->
        <a
          v-if="!isNativeBuild"
          class="app-store-badge"
          href="https://apps.apple.com/us/app/bball-sim/id6774754906"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Download Bball Sim on the App Store"
        >
          <svg
            class="app-store-badge-svg"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 160 50"
            role="img"
            aria-hidden="true"
          >
            <!-- Black rounded background + 1px subtle border -->
            <rect width="160" height="50" rx="8" fill="#000" />
            <rect
              x="0.5"
              y="0.5"
              width="159"
              height="49"
              rx="7.5"
              fill="none"
              stroke="rgba(255, 255, 255, 0.18)"
            />
            <!-- Apple logo. Canonical Apple-style glyph with intrinsic
                 bounds roughly (0,0)-(18,22). Translated into the badge's
                 vertical center and the left padding column. -->
            <g transform="translate(13, 13)" fill="#fff">
              <path d="M14.94 11.38c-.02-2.13 1.74-3.16 1.82-3.21-1-1.46-2.55-1.66-3.1-1.68-1.32-.13-2.58.78-3.25.78-.68 0-1.71-.76-2.81-.74-1.45.02-2.78.84-3.52 2.15-1.5 2.6-.38 6.44 1.08 8.55.71 1.03 1.56 2.18 2.67 2.14 1.07-.04 1.48-.69 2.78-.69s1.66.69 2.79.66c1.15-.02 1.89-1.05 2.59-2.09.82-1.21 1.16-2.37 1.18-2.43-.03-.01-2.26-.86-2.28-3.44zM12.87 4.69c.58-.71.97-1.68.87-2.66-.84.03-1.86.56-2.46 1.27-.54.63-1.01 1.64-.88 2.58.94.07 1.88-.47 2.47-1.19z" />
            </g>
            <!-- Tagline above the wordmark -->
            <text
              x="42"
              y="20"
              fill="#fff"
              font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
              font-size="8"
              font-weight="400"
              letter-spacing="0.4"
            >Download on the</text>
            <!-- Wordmark -->
            <text
              x="42"
              y="38"
              fill="#fff"
              font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
              font-size="18"
              font-weight="600"
              letter-spacing="-0.3"
            >App Store</text>
          </svg>
        </a>
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
      <div class="footer-links">
        <a
          class="footer-link"
          href="https://bball-sim.com/support"
          target="_blank"
          rel="noopener"
        >Contact Us</a>
        <span class="footer-sep">·</span>
        <a
          class="footer-link"
          href="https://bball-sim.com/privacy"
          target="_blank"
          rel="noopener"
        >Privacy</a>
      </div>
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
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 1rem;
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

/* Apple App Store badge — anchored below the hero CTAs. Width is held at
   the Apple-spec aspect ratio (135:40); transform-only hover stays
   GPU-friendly. focus-visible matches the rest of the hero's accent
   color so keyboard nav remains visible against the dark background. */
.app-store-badge {
  display: inline-block;
  margin-top: 1.5rem;
  line-height: 0;
  border-radius: 7px;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.app-store-badge:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.app-store-badge:focus-visible {
  outline: 2px solid var(--color-primary, #ffc125);
  outline-offset: 3px;
}

.app-store-badge-svg {
  display: block;
  width: 180px;   /* 160 × 1.125 — well above Apple's 119px minimum */
  height: 56px;
}

@media (max-width: 640px) {
  .app-store-badge-svg {
    width: 156px;
    height: 49px;
  }
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
  font-weight: 400;
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
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.footer-links {
  display: flex;
  align-items: center;
  gap: 8px;
}

.footer-sep {
  color: var(--color-text-tertiary);
  opacity: 0.5;
}

.footer-link {
  color: var(--color-text-secondary);
  text-decoration: none;
  transition: color 0.2s ease;
}

.footer-link:hover {
  color: var(--color-text-primary);
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
