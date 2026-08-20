<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Coins, Check, Star, ChevronUp, Plus } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { useAudioStore } from '@/stores/audio'
import { useSyncStore } from '@/stores/sync'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { coachBadges, COACH_BADGE_LEVELS, nextCoachBadgeLevel } from '@/engine/data/coachBadges'
import { StandardModal } from '@/components/ui'
import api from '@/composables/useApi'
import { t } from '@wl-i18n/i18n.js'

const props = defineProps({
  show: { type: Boolean, default: false },
  campaignId: { type: [String, Number], required: true },
  team: { type: Object, default: null },
})

const emit = defineEmits(['close', 'purchased'])

const authStore = useAuthStore()
const toastStore = useToastStore()
const syncStore = useSyncStore()
const audio = useAudioStore()
const router = useRouter()

const purchasing = ref(null) // badge id currently being purchased

const tokens = computed(() => authStore.profile?.tokens ?? 0)

// Map of owned badge id → owned entry { id, level, source, purchasedAt? }.
const ownedById = computed(() => {
  const map = new Map()
  const list = props.team?.coach?.badges ?? []
  for (const entry of list) {
    if (entry?.id) map.set(entry.id, entry)
  }
  return map
})

// Group badge defs by category for display
const grouped = computed(() => {
  const byCategory = {}
  for (const badge of coachBadges) {
    if (!byCategory[badge.category]) byCategory[badge.category] = []
    byCategory[badge.category].push(badge)
  }
  return byCategory
})

const CATEGORY_LABELS = {
  development: 'Player Development',
  gameManagement: 'Game Management',
  defensiveIQ: 'Defensive IQ',
  offensiveIQ: 'Offensive IQ',
  strictness: 'Strictness',
}

const TIER_COLORS = {
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold: '#FFD700',
  hof: '#9333EA',
}

function formatCost(cost) {
  if (cost == null) return ''
  if (cost >= 1000) return `${(cost / 1000).toFixed(cost % 1000 === 0 ? 0 : 1)}K`
  return String(cost)
}

function levelLabel(level) {
  if (!level) return ''
  if (level === 'hof') return 'HOF'
  return level.charAt(0).toUpperCase() + level.slice(1)
}

function ownedLevel(badge) {
  return ownedById.value.get(badge.id)?.level ?? null
}

function nextLevel(badge) {
  return nextCoachBadgeLevel(ownedLevel(badge))
}

function nextCost(badge) {
  const next = nextLevel(badge)
  if (!next) return null
  return badge.cost?.[next] ?? null
}

function isMaxed(badge) {
  return ownedLevel(badge) === 'hof'
}

function canAfford(badge) {
  const cost = nextCost(badge)
  return cost != null && tokens.value >= cost
}

// True if the owned level is at-or-beyond the given level (used for tier-dot rendering)
function hasReached(badge, level) {
  const current = ownedLevel(badge)
  if (!current) return false
  return COACH_BADGE_LEVELS.indexOf(current) >= COACH_BADGE_LEVELS.indexOf(level)
}

async function purchase(badge) {
  if (!props.team || !props.team.coach) {
    toastStore.showError(t('No coach found on team'))
    return
  }
  if (isMaxed(badge)) return
  const next = nextLevel(badge)
  const cost = nextCost(badge)
  if (!next || cost == null) return
  if (tokens.value < cost) {
    toastStore.showError(t('Need {a} tokens — you have {b}', { a: cost, b: tokens.value }))
    return
  }
  if (purchasing.value) return

  purchasing.value = badge.id
  audio.suppressClickSound() // cha-ching on success instead of the generic tap
  try {
    const response = await api.post('/api/user/tokens', { amount: -cost })
    if (authStore.profile) {
      authStore.profile.tokens = response.data.tokens
    }

    // Refetch the team to avoid clobbering concurrent writes, then upgrade
    // the badge entry in place (or insert at bronze if not yet owned).
    const team = await TeamRepository.get(props.campaignId, props.team.id)
    if (!team || !team.coach) throw new Error('Team or coach missing')

    const existing = Array.isArray(team.coach.badges) ? [...team.coach.badges] : []
    const idx = existing.findIndex(b => b?.id === badge.id)
    const newEntry = {
      id: badge.id,
      level: next,
      source: 'purchased',
      purchasedAt: new Date().toISOString(),
    }
    if (idx >= 0) {
      // Preserve 'master' source if the badge was originally master-seeded —
      // useful later if we ever want to show the distinction in UI.
      const prev = existing[idx]
      existing[idx] = {
        ...newEntry,
        source: prev.source === 'master' ? 'master' : 'purchased',
      }
    } else {
      existing.push(newEntry)
    }
    team.coach.badges = existing
    await TeamRepository.save(team)

    audio.purchase()
    toastStore.showSuccess(`${badge.name} → ${levelLabel(next)}`)
    syncStore.markDirty()
    emit('purchased', { badgeId: badge.id, level: next, team })
  } catch (err) {
    console.error('Failed to purchase coach badge:', err)
    toastStore.showError(t('Failed to purchase badge'))
  } finally {
    purchasing.value = null
  }
}

function close() {
  emit('close')
}

function goToStore() {
  emit('close')
  router.push('/store')
}
</script>

<template>
  <StandardModal
    :show="show"
    :title="$t('Coach Badge Store')"
    size="lg"
    @close="close"
  >
    <div class="store-header">
      <div class="token-group">
        <div class="token-balance">
          <Coins :size="16" />
          <span class="token-amount">{{ tokens.toLocaleString() }}</span>
          <span class="token-label">{{ $t('tokens') }}</span>
        </div>
        <button type="button" class="buy-tokens-btn" @click="goToStore" :title="$t('Get more tokens in the Store')">
          <Plus :size="14" />
          <span>{{ $t('Get Tokens') }}</span>
        </button>
      </div>
      <p class="store-subtitle">{{ $t('Each badge upgrades through four tiers — bronze, silver, gold, HOF. Owned badges always apply.') }}</p>
    </div>

    <div v-for="(badges, category) in grouped" :key="category" class="category-group">
      <h3 class="category-title">{{ $tDynamic(CATEGORY_LABELS[category] || category) }}</h3>
      <div class="badge-grid">
        <div
          v-for="badge in badges"
          :key="badge.id"
          class="badge-card"
          :class="{
            owned: !!ownedLevel(badge),
            maxed: isMaxed(badge),
            unaffordable: !isMaxed(badge) && !canAfford(badge),
          }"
        >
          <div class="badge-card-header">
            <Star
              :size="14"
              :style="{ color: TIER_COLORS[ownedLevel(badge) || 'bronze'] }"
              :fill="ownedLevel(badge) ? TIER_COLORS[ownedLevel(badge)] : 'transparent'"
            />
            <span class="badge-name">{{ $tDynamic(badge.name) }}</span>
            <span
              v-if="ownedLevel(badge)"
              class="badge-current-level"
              :style="{ color: TIER_COLORS[ownedLevel(badge)] }"
            >
              {{ levelLabel(ownedLevel(badge)) }}
            </span>
          </div>
          <p class="badge-description">{{ $tDynamic(badge.description) }}</p>

          <!-- Tier progress dots -->
          <div class="tier-dots">
            <span
              v-for="lvl in COACH_BADGE_LEVELS"
              :key="lvl"
              class="tier-dot"
              :class="{ active: hasReached(badge, lvl), next: nextLevel(badge) === lvl }"
              :style="hasReached(badge, lvl) ? { background: TIER_COLORS[lvl] } : {}"
              :title="levelLabel(lvl)"
            />
          </div>

          <div class="badge-card-footer">
            <span v-if="isMaxed(badge)" class="badge-maxed">
              <Check :size="14" />
              {{ $t('Maxed (HOF)') }}
            </span>
            <template v-else>
              <span class="badge-cost">
                <Coins :size="13" />
                {{ formatCost(nextCost(badge)) }}
              </span>
              <button
                class="badge-purchase-btn"
                :disabled="purchasing !== null"
                @click="canAfford(badge) ? purchase(badge) : goToStore()"
              >
                <ChevronUp v-if="ownedLevel(badge) && canAfford(badge)" :size="14" />
                <span>
                  {{ purchasing === badge.id ? $t('Working...') : !canAfford(badge) ? $t('Get Tokens') : ownedLevel(badge) ? $t('Upgrade to {a}', { a: levelLabel(nextLevel(badge)) }) : $t('Unlock Bronze') }}
                </span>
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn-close-footer" @click="close">{{ $t('Close') }}</button>
    </template>
  </StandardModal>
</template>

<style scoped>
.store-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--glass-border);
}

.token-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.token-balance {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #FFD700;
  font-weight: 600;
}

.buy-tokens-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.buy-tokens-btn:hover {
  background: var(--color-bg-hover, rgba(255, 255, 255, 0.06));
  border-color: var(--color-primary);
}

.token-amount {
  font-size: 1.05rem;
}

.token-label {
  color: var(--color-text-secondary);
  font-weight: 500;
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
}

.store-subtitle {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.category-group {
  margin-bottom: 20px;
}

.category-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.1rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0 0 10px 0;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.badge-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.badge-card {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.badge-card:hover:not(.maxed) {
  border-color: var(--color-text-secondary);
  transform: translateY(-1px);
}

.badge-card.owned {
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-tertiary));
  border-color: color-mix(in srgb, var(--color-primary) 30%, transparent);
}

.badge-card.maxed {
  border-color: #9333EA;
  background: color-mix(in srgb, #9333EA 12%, var(--color-bg-tertiary));
}

.badge-card.unaffordable {
  opacity: 0.65;
}

.badge-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.badge-name {
  flex: 1;
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.badge-current-level {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.badge-description {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.4;
  color: var(--color-text-secondary);
}

.tier-dots {
  display: flex;
  gap: 4px;
  align-items: center;
}

.tier-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
  transition: background 0.2s ease, transform 0.2s ease;
}

.tier-dot.active {
  border-color: rgba(255, 255, 255, 0.4);
}

.tier-dot.next {
  outline: 1px dashed var(--color-primary);
  outline-offset: 1px;
}

.badge-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  gap: 8px;
}

.badge-maxed {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  font-weight: 700;
  color: #9333EA;
  width: 100%;
  justify-content: center;
}

.badge-cost {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  font-weight: 600;
  color: #FFD700;
}

.badge-purchase-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  border: none;
  color: white;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.2s ease;
}

.badge-purchase-btn:hover:not(:disabled) {
  background: var(--color-primary-dark);
}

.badge-purchase-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-close-footer {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 20px;
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-close-footer:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}
</style>
