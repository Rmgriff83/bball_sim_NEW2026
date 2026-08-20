<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton } from '@/components/ui'
import { Gamepad2, BarChart3, Trophy, ChevronRight, Home } from 'lucide-vue-next'
import { Capacitor } from '@capacitor/core'

const router = useRouter()
const authStore = useAuthStore()

const isAuthenticated = computed(() => authStore.isAuthenticated)

// The App Store + Google Play badges only make sense on the WEB build —
// inside any native app (iOS or Android) the user already installed it, so the
// links are redundant (and pointing users at the wrong store is worse).
// - iOS: `build:ios` sets VITE_NATIVE_BUILD, so it's stripped at build time.
// - Android: the build doesn't set that flag, so we also gate on the runtime
//   Capacitor.isNativePlatform() check (getPlatform() is 'web' | 'ios' | 'android').
const showStoreBadges = !import.meta.env.VITE_NATIVE_BUILD && !Capacitor.isNativePlatform()

// Socials nav (top-right corner) — shown on EVERY build (web + native):
// unlike the store badges, in-app users are exactly who we want in the
// community. Add future socials (Discord, X, …) to this list.
const REDDIT_URL = 'https://www.reddit.com/r/Bball_Sim/'
async function openSocial(e, url) {
  if (!Capacitor.isNativePlatform()) return // web: the anchor opens a new tab
  // WKWebView swallows target=_blank / drops window.open after an await —
  // Browser.open is the reliable native path (same as services/appUpdate.js).
  e.preventDefault()
  const { Browser } = await import('@capacitor/browser')
  await Browser.open({ url })
}
</script>

<template>
  <div class="home-page">
    <!-- Home marker — top-left twin of the socials nav, for cross-property
         uniformity with the marketing site's header (where it links home).
         Here it's purely decorative: this page IS home, so it's inert and
         hidden from assistive tech. -->
    <div class="home-nav" aria-hidden="true">
      <span class="home-marker">
        <Home :size="20" />
      </span>
    </div>

    <!-- Socials nav — minimal icon row pinned to the top-right corner, on all
         builds (body's global safe-area padding keeps it below the notch on
         native). Grows as we add socials: one .social-link per network. Native
         taps route through Browser.open (WKWebView swallows target=_blank). -->
    <nav class="socials-nav" aria-label="Community links">
      <a
        class="social-link"
        :href="REDDIT_URL"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Join the Bball Sim community on Reddit"
        :title="$t('r/Bball_Sim')"
        @click="openSocial($event, REDDIT_URL)"
      >
        <svg
          class="social-icon"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          role="img"
          aria-hidden="true"
        >
          <!-- Reddit "Snoo" mark built from primitives, monochrome: black
               disc, white ears/antenna/head, black eyes + smile. -->
          <circle cx="12" cy="12" r="12" fill="#000" />
          <circle cx="17.9" cy="5.7" r="1.5" fill="#fff" />
          <path
            d="M12.4 8.6 c.3-2.4 1.7-3.6 4.2-3.1"
            stroke="#fff"
            stroke-width="1"
            fill="none"
            stroke-linecap="round"
          />
          <circle cx="5.3" cy="10.9" r="1.8" fill="#fff" />
          <circle cx="18.7" cy="10.9" r="1.8" fill="#fff" />
          <ellipse cx="12" cy="13.7" rx="6.8" ry="4.7" fill="#fff" />
          <circle cx="9.5" cy="12.9" r="1.15" fill="#000" />
          <circle cx="14.5" cy="12.9" r="1.15" fill="#000" />
          <path
            d="M9.3 15.6 c1.7 1.5 3.7 1.5 5.4 0"
            stroke="#000"
            stroke-width="1"
            fill="none"
            stroke-linecap="round"
          />
        </svg>
      </a>
    </nav>

    <!-- Hero Section -->
    <main class="hero-section">
      <div class="hero-content">
        <!-- Logo/Title -->
        <div class="hero-badge">{{ $t('DYNASTY BASKETBALL') }}</div>
        <!-- i18n-ignore -->
        <h1 class="hero-title">BBALL SIM</h1>
        <p class="hero-subtitle">
          {{ $t('Manage your team. Chase Championships. Build your dynasty.') }}
        </p>

        <!-- CTA Buttons -->
        <div class="hero-actions">
          <template v-if="isAuthenticated">
            <button class="cosmic-btn" @click="router.push('/dashboard')">
              {{ $t('Go to Dashboard') }}
              <ChevronRight :size="20" />
            </button>
          </template>
          <template v-else>
            <button class="cosmic-btn" @click="router.push('/register')">
              {{ $t('Start Playing') }}
              <ChevronRight :size="20" />
            </button>
            <button class="signin-btn" @click="router.push('/login')">
              {{ $t('Sign In') }}
            </button>
          </template>
        </div>

        <!-- Store badges — web build only. Inline SVGs so we're not hotlinking
             the stores' CDNs; the designs follow the official "Download on the
             App Store" / "Get it on Google Play" badge specs. Native users are
             already in the app, so this whole block is gated off in-app. -->
        <div v-if="showStoreBadges" class="store-badges">
        <a
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
            >Download on the</text><!-- i18n-ignore -->
            <!-- Wordmark -->
            <text
              x="42"
              y="38"
              fill="#fff"
              font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
              font-size="18"
              font-weight="600"
              letter-spacing="-0.3"
            >App Store</text><!-- i18n-ignore -->
          </svg>
        </a>

        <!-- Google Play badge — inline SVG following the official
             "Get it on Google Play" spec (black pill, colored play triangle,
             GET IT ON / Google Play wordmark). -->
        <a
          class="google-play-badge"
          href="https://play.google.com/store/apps/details?id=com.bballsim.app"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Get Bball Sim on Google Play"
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
            <!-- Google Play triangle — the modern play mark: a right-pointing
                 triangle with the brand's blue→cyan gradient. -->
            <defs>
              <linearGradient id="gp-triangle" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#00E1FF" />
                <stop offset="1" stop-color="#00A0FF" />
              </linearGradient>
            </defs>
            <g transform="translate(15, 14)">
              <path d="M0 0.5 L18 11 L0 21.5 Z" fill="url(#gp-triangle)" />
            </g>
            <!-- Tagline above the wordmark -->
            <text
              x="42"
              y="20"
              fill="#fff"
              font-family="Roboto, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
              font-size="8"
              font-weight="400"
              letter-spacing="0.8"
            >GET IT ON</text><!-- i18n-ignore -->
            <!-- Wordmark -->
            <text
              x="42"
              y="38"
              fill="#fff"
              font-family="Roboto, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
              font-size="17"
              font-weight="500"
              letter-spacing="-0.2"
            >Google Play</text><!-- i18n-ignore -->
          </svg>
        </a>
        </div>
      </div>

      <!-- Scanlines are now a global body::after (see assets/styles/main.css);
           the retro grid + vignette overlays were removed as too heavy. -->
    </main>

    <!-- Features Section -->
    <section class="features-section">
      <div class="features-container">
        <h2 class="features-title">{{ $t('The Ultimate Basketball Experience') }}</h2>

        <div class="features-grid">
          <div class="feature-card">
            <div class="feature-icon">
              <Gamepad2 :size="28" />
            </div>
            <h3 class="feature-heading">{{ $t('Deep Simulation') }}</h3>
            <p class="feature-description">
              {{ $t('Possession-by-possession gameplay with realistic player ratings, badge synergies, and dynamic play calling') }}
            </p>
          </div>

          <div class="feature-card">
            <div class="feature-icon">
              <BarChart3 :size="28" />
            </div>
            <h3 class="feature-heading">{{ $t('Franchise Mode') }}</h3>
            <p class="feature-description">
              {{ $t('Manage rosters, handle finances, make trades, and guide your team through multiple seasons') }}
            </p>
          </div>

          <div class="feature-card">
            <div class="feature-icon">
              <Trophy :size="28" />
            </div>
            <h3 class="feature-heading">{{ $t('Build a Dynasty') }}</h3>
            <p class="feature-description">
              {{ $t('Draft promising prospects, develop young talent, and compete for championships year after year') }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="home-footer">
      <!-- i18n-ignore -->
      <p>{{ $t('Bball Sim - Dynasty Basketball') }} &copy; 2026</p>
    </footer>
  </div>
</template>

<style scoped>
.home-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  position: relative; /* anchors .socials-nav to the page's top-right */
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
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: #FFC125;
  margin-top: 1.5rem;
  text-transform: uppercase;
}

.hero-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: clamp(4rem, 12vw, 8rem);
  font-weight: 400;
  letter-spacing: 0.05em;
  line-height: 1;
  color: var(--color-primary);
  margin-bottom: 1rem;
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

/* Store badges row — App Store + Google Play sit side by side below the hero
   CTAs, wrapping to a stack on narrow screens. */
.store-badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

/* App Store / Google Play badges. Transform-only hover stays GPU-friendly;
   focus-visible matches the rest of the hero's accent color so keyboard nav
   remains visible against the dark background. */
.app-store-badge,
.google-play-badge {
  display: inline-block;
  line-height: 0;
  border-radius: 7px;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.app-store-badge:hover,
.google-play-badge:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.app-store-badge:focus-visible,
.google-play-badge:focus-visible {
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

/* Home marker — top-left mirror of the socials nav. Same glass-disc language
   but greyscale and inert (no hover lift/pointer): it exists for visual
   uniformity with the marketing site's header, not as a control. */
.home-nav {
  position: absolute;
  top: 0.9rem;
  left: 1rem;
  display: flex;
  align-items: center;
  z-index: 10;
}

.home-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px; /* keeps vertical alignment with the 38px social discs */
  height: 38px;
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  transition: color 0.18s ease, transform 0.18s ease;
}

.home-marker:hover {
  color: rgba(255, 255, 255, 0.9);
  transform: translateY(-1px);
}

/* Socials nav — minimal icon row in the top-right corner. Each link is a
   small glass disc holding the network's mark; add more .social-link anchors
   as socials grow and the row extends leftward. */
.socials-nav {
  position: absolute;
  top: 0.9rem;
  right: 1rem;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  z-index: 10;
}

.social-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.social-link:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  border-color: rgba(255, 255, 255, 0.3);
}

.social-link:focus-visible {
  outline: 2px solid var(--color-primary, #ffc125);
  outline-offset: 3px;
}

.social-icon {
  display: block;
  width: 32px;
  height: 32px;
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
