<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown, Mail, ArrowLeft } from 'lucide-vue-next'

const router = useRouter()

const faqs = ref([
  {
    q: 'How do tokens work?',
    a: 'Tokens are the in-game currency for BBALL SIM. You earn them through gameplay (wins, rewards, etc.) and can also buy bundles from the Store. Spend them on facility upgrades, scouts, trainers, badge purchases, and other GM tools.',
    open: false,
  },
  {
    q: "I bought tokens but they haven't appeared in my balance.",
    a: 'Tokens are credited via our payment provider\'s webhook, which usually completes within a few seconds but can occasionally take up to a few minutes. Try closing and reopening the app. If your balance still hasn\'t updated after 5 minutes, email us with your Apple ID purchase confirmation and we\'ll credit them manually.',
    open: false,
  },
  {
    q: 'Does my progress sync across devices?',
    a: 'Yes. Your account, campaigns, rosters, and token balance are stored on our servers and tied to your login. Sign in on any device to pick up where you left off.',
    open: false,
  },
  {
    q: 'How do I delete my account?',
    a: 'Email us from the address tied to your account and we\'ll delete it within 7 days, along with all associated campaign data.',
    open: false,
  },
  {
    q: 'I found a bug — what should I do?',
    a: 'Email us with a short description of what happened and what you expected, plus your account email. Screenshots help a lot. We respond to bug reports within 48 hours.',
    open: false,
  },
])

function toggle(i) {
  faqs.value[i].open = !faqs.value[i].open
}
</script>

<template>
  <div class="support-page">
    <header class="support-header">
      <button class="back-link" @click="router.push('/')">
        <ArrowLeft :size="18" />
        <span>Back</span>
      </button>
      <h1 class="page-title">Support</h1>
      <p class="page-subtitle">Quick answers to common questions, and a direct line if you need more.</p>
    </header>

    <main class="support-main">
      <section class="faq-section">
        <h2 class="section-title">Frequently Asked</h2>
        <div class="faq-list">
          <button
            v-for="(item, i) in faqs"
            :key="i"
            class="faq-item"
            :class="{ open: item.open }"
            @click="toggle(i)"
            :aria-expanded="item.open"
          >
            <div class="faq-question">
              <span>{{ item.q }}</span>
              <ChevronDown :size="18" class="faq-chevron" />
            </div>
            <div v-if="item.open" class="faq-answer">{{ item.a }}</div>
          </button>
        </div>
      </section>

      <section class="contact-section">
        <div class="contact-card">
          <Mail :size="28" class="contact-icon" />
          <h2 class="contact-title">Still need help?</h2>
          <p class="contact-text">
            We respond to every email within 48 hours.
          </p>
          <a class="contact-email" href="mailto:rmgriffus@comcast.net">send us an email</a>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.support-page {
  min-height: 100vh;
  padding: 24px 16px 64px;
  max-width: 720px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

.support-header {
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
  margin: 0;
  line-height: 1.5;
}

.section-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0 0 16px;
  letter-spacing: 0.02em;
}

.faq-section {
  margin-bottom: 48px;
}

.faq-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.faq-item {
  width: 100%;
  text-align: left;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.faq-item:hover {
  border-color: rgba(255, 255, 255, 0.2);
}

.faq-item.open {
  background: rgba(255, 255, 255, 0.04);
}

.faq-question {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.faq-chevron {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.faq-item.open .faq-chevron {
  transform: rotate(180deg);
}

.faq-answer {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--glass-border);
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--color-text-secondary);
}

.contact-section {
  margin-top: 32px;
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
