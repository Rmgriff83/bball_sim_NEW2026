<script setup>
import { useRouter } from 'vue-router'
import { ArrowLeft, Mail } from 'lucide-vue-next'

const router = useRouter()
const lastUpdated = 'June 1, 2026'
</script>

<template>
  <div class="privacy-page">
    <header class="privacy-header">
      <button class="back-link" @click="router.push('/')">
        <ArrowLeft :size="18" />
        <span>Back</span>
      </button>
      <h1 class="page-title">Privacy Policy</h1>
      <p class="page-subtitle">How BBALL SIM collects, uses, and protects your information.</p>
      <p class="last-updated">Last updated: {{ lastUpdated }}</p>
    </header>

    <main class="privacy-main">
      <section class="privacy-section">
        <h2>Overview</h2>
        <p>
          BBALL SIM ("we", "our", "us") respects your privacy. This policy explains what
          information we collect, how we use it, who we share it with, and the choices you
          have. It applies to the BBALL SIM mobile app and our website at
          <a href="https://bball-sim.com">bball-sim.com</a>.
        </p>
      </section>

      <section class="privacy-section">
        <h2>Information We Collect</h2>
        <ul>
          <li><strong>Account information.</strong> When you create an account, we collect your email address and a password (stored hashed, never in plain text). You may optionally provide a display name.</li>
          <li><strong>Gameplay data.</strong> Your campaigns, rosters, in-game decisions, and statistics are stored so you can resume across devices.</li>
          <li><strong>Purchase data.</strong> When you buy a token bundle, our payment processors (Apple App Store on iOS and Google Play on Android — both via RevenueCat — and Stripe on web) handle the transaction. We receive a confirmation that includes the bundle purchased and a transaction identifier. We do not receive or store your full payment card details.</li>
          <li><strong>Technical data.</strong> Basic device and usage information such as platform (iOS / Android / web), app version, language, and crash diagnostics may be collected automatically to keep the app running and improve quality.</li>
        </ul>
      </section>

      <section class="privacy-section">
        <h2>How We Use Your Information</h2>
        <ul>
          <li>Provide and operate the app, including syncing campaigns across your devices.</li>
          <li>Process purchases and credit purchased tokens to your account.</li>
          <li>Communicate with you about account, billing, or support requests.</li>
          <li>Detect, prevent, and respond to fraud, abuse, or technical issues.</li>
          <li>Improve the app — for example, identifying and fixing crashes.</li>
        </ul>
        <p>
          We do not sell your personal information. We do not use your information for
          third-party advertising.
        </p>
      </section>

      <section class="privacy-section">
        <h2>Third-Party Services</h2>
        <p>We use a small number of trusted third parties to operate the app:</p>
        <ul>
          <li><strong>Apple App Store + RevenueCat</strong> — process in-app purchases on iOS and provide receipt validation.</li>
          <li><strong>Google Play + RevenueCat</strong> — process in-app purchases on Android and provide purchase validation.</li>
          <li><strong>Stripe</strong> — processes purchases initiated from our website.</li>
          <li><strong>Our own backend</strong> at <code>api.bball-sim.com</code> — stores your account, gameplay data, and token balance.</li>
        </ul>
        <p>
          We do not use third-party analytics, advertising, or crash-reporting
          services. We do not use device identifiers like IDFA.
        </p>
        <p>
          Each of these providers operates under their own privacy policies. We only
          share information with them as strictly needed to provide the service you
          requested.
        </p>
      </section>

      <section class="privacy-section">
        <h2>Data Retention</h2>
        <p>
          We keep your account and gameplay data for as long as your account is active.
          If you delete your account, we will remove your personal information within
          7 days, except where we are required to retain certain records (for example,
          purchase records for tax or accounting purposes).
        </p>
      </section>

      <section class="privacy-section">
        <h2>Your Rights & Choices</h2>
        <ul>
          <li><strong>Access or correct your information.</strong> You can view and edit your profile inside the app, or email us for assistance.</li>
          <li><strong>Delete your account.</strong> Email the address below and we'll remove your account and associated data within 7 days.</li>
          <li><strong>Refunds.</strong> Token purchases are processed by Apple, Google, or Stripe. For refunds, use the App Store's refund flow (Apple) or Google Play's refund flow (Android); Stripe refunds can be requested through us.</li>
        </ul>
      </section>

      <section class="privacy-section">
        <h2>Children's Privacy</h2>
        <p>
          BBALL SIM is rated 4+ and is not directed to children under 13. We do not
          knowingly collect personal information from children under 13. If you believe
          a child under 13 has provided us with personal information, email us and we
          will delete it.
        </p>
      </section>

      <section class="privacy-section">
        <h2>Changes to This Policy</h2>
        <p>
          We may update this policy from time to time. We'll post the new version on
          this page and update the "Last updated" date above. Material changes will be
          announced in-app or by email.
        </p>
      </section>

      <section class="contact-section">
        <div class="contact-card">
          <Mail :size="28" class="contact-icon" />
          <h2 class="contact-title">Questions?</h2>
          <p class="contact-text">
            Get in touch about anything privacy-related — we'll respond within 48 hours.
          </p>
          <a class="contact-email" href="mailto:rmgriffus@comcast.net">send us an email</a>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.privacy-page {
  min-height: 100vh;
  padding: 24px 16px 64px;
  max-width: 760px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

.privacy-header {
  margin-bottom: 32px;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  padding: 4px 0;
  cursor: pointer;
  margin-bottom: 16px;
}

.back-link:hover {
  color: var(--color-text-primary);
}

.page-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2.5rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0 0 8px;
  letter-spacing: 0.02em;
}

.page-subtitle {
  font-size: 1rem;
  color: var(--color-text-secondary);
  margin: 0 0 6px;
  line-height: 1.5;
}

.last-updated {
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
  margin: 0;
}

.privacy-section {
  margin-bottom: 32px;
}

.privacy-section h2 {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0 0 12px;
  letter-spacing: 0.02em;
}

.privacy-section p,
.privacy-section li {
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--color-text-secondary);
  margin: 0 0 12px;
}

.privacy-section ul {
  padding-left: 20px;
  margin: 0 0 12px;
}

.privacy-section li {
  margin-bottom: 8px;
}

.privacy-section a {
  color: var(--color-primary);
  text-decoration: none;
}

.privacy-section a:hover {
  text-decoration: underline;
}

.privacy-section strong {
  color: var(--color-text-primary);
}

.privacy-section code {
  background: rgba(255, 255, 255, 0.05);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.85em;
}

.contact-section {
  margin-top: 40px;
}

.contact-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 32px 24px;
  text-align: center;
}

.contact-icon {
  color: var(--color-primary);
  margin-bottom: 12px;
}

.contact-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.75rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0 0 8px;
  letter-spacing: 0.02em;
}

.contact-text {
  color: var(--color-text-secondary);
  margin: 0 0 20px;
  font-size: 0.95rem;
}

.contact-email {
  display: inline-block;
  padding: 12px 24px;
  background: var(--gradient-cosmic);
  color: #000;
  text-decoration: none;
  font-weight: 600;
  border-radius: var(--radius-full);
  transition: filter 0.2s ease, transform 0.2s ease;
}

.contact-email:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}
</style>
