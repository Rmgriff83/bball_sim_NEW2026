<script setup>
import { ref, computed } from 'vue'
import { Coins, Check, Star, ChevronUp, Lock } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useTeamStore } from '@/stores/team'
import { useToastStore } from '@/stores/toast'
import { useAudioStore } from '@/stores/audio'
import { StandardModal } from '@/components/ui'
import {
  PLAYER_BADGE_LEVELS,
  getBadgeStoreEntries,
} from '@/engine/data/playerBadgeStore'

const props = defineProps({
  show: { type: Boolean, default: false },
  campaignId: { type: [String, Number], required: true },
  player: { type: Object, default: null },
})

const emit = defineEmits(['close', 'purchased'])

const authStore = useAuthStore()
const teamStore = useTeamStore()
const toastStore = useToastStore()
const audio = useAudioStore()

const purchasing = ref(null) // badge id currently being purchased

const tokens = computed(() => authStore.profile?.tokens ?? 0)

// Recomputes whenever the underlying player ref changes (the team store
// mutates the player's badges in place + replaces the roster entry, so the
// reactive props.player updates after each purchase).
const entries = computed(() => getBadgeStoreEntries(props.player))

const grouped = computed(() => {
  const byCategory = {}
  for (const entry of entries.value) {
    if (!byCategory[entry.category]) byCategory[entry.category] = []
    byCategory[entry.category].push(entry)
  }
  return byCategory
})

const CATEGORY_LABELS = {
  shooting: 'Shooting',
  finishing: 'Finishing',
  playmaking: 'Playmaking',
  defense: 'Defense',
  physical: 'Physical',
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

// Tier-dot state — three flavors per dot:
//   - active: the badge is currently AT or ABOVE this level
//   - next:   this is the next purchasable level
//   - locked: the level is above the per-player max (the player can never
//             reach this tier on this badge)
function dotState(entry, level) {
  const lvlIdx = PLAYER_BADGE_LEVELS.indexOf(level)
  const ownIdx = entry.currentLevel ? PLAYER_BADGE_LEVELS.indexOf(entry.currentLevel) : -1
  const maxIdx = PLAYER_BADGE_LEVELS.indexOf(entry.maxLevel)
  return {
    active: ownIdx >= lvlIdx,
    next: entry.nextLevel === level,
    locked: lvlIdx > maxIdx,
  }
}

async function purchase(entry) {
  if (purchasing.value) return
  if (!entry.nextLevel) return
  if (tokens.value < (entry.nextCost ?? Infinity)) {
    toastStore.showError(`Need ${entry.nextCost} tokens — you have ${tokens.value}`)
    return
  }

  purchasing.value = entry.badge.id
  audio.suppressClickSound() // cha-ching on success instead of the generic tap
  try {
    const result = await teamStore.purchasePlayerBadge(
      props.campaignId,
      props.player.id,
      entry.badge.id,
    )
    audio.purchase()
    toastStore.showSuccess(`${entry.badge.name} → ${levelLabel(result.level)}`)
    emit('purchased', { badgeId: entry.badge.id, level: result.level })
  } catch (err) {
    console.error('Failed to purchase player badge:', err)
    toastStore.showError(err.message || 'Failed to purchase badge')
  } finally {
    purchasing.value = null
  }
}

function close() {
  emit('close')
}
</script>

<template>
  <StandardModal
    :show="show"
    :title="player ? `Badge Store · ${player.name || ''}` : 'Badge Store'"
    size="lg"
    @close="close"
  >
    <div class="store-header">
      <div class="store-header-row">
        <div class="token-balance">
          <Coins :size="16" />
          <span class="token-amount">{{ tokens.toLocaleString() }}</span>
          <span class="token-label">tokens</span>
        </div>
        <div v-if="player" class="player-summary">
          <span class="player-summary-label">Position</span>
          <span class="player-summary-value">{{ player.position }}<template v-if="player.secondaryPosition">/{{ player.secondaryPosition }}</template></span>
          <span class="player-summary-divider">·</span>
          <span class="player-summary-label">Potential</span>
          <span class="player-summary-value">{{ player.potentialRating ?? player.potential_rating ?? '—' }}</span>
        </div>
      </div>
      <p class="store-subtitle">
        Each badge has a per-player ceiling based on position fit, attribute fit, and potential. Locked tiers can't be reached for this player.
      </p>
    </div>

    <div v-if="entries.length === 0" class="empty-store">
      No badges are available for this player. Improve their attributes to unlock options.
    </div>

    <div v-for="(list, category) in grouped" :key="category" class="category-group">
      <h3 class="category-title">{{ CATEGORY_LABELS[category] || category }}</h3>
      <div class="badge-grid">
        <div
          v-for="entry in list"
          :key="entry.badge.id"
          class="badge-card"
          :class="{
            owned: !!entry.currentLevel,
            maxed: entry.isMaxedForPlayer,
            unaffordable: !entry.isMaxedForPlayer && entry.nextCost != null && tokens < entry.nextCost,
          }"
        >
          <div class="badge-card-header">
            <Star
              :size="14"
              :style="{ color: TIER_COLORS[entry.currentLevel || 'bronze'] }"
              :fill="entry.currentLevel ? TIER_COLORS[entry.currentLevel] : 'transparent'"
            />
            <span class="badge-name">{{ entry.badge.name }}</span>
            <span
              v-if="entry.currentLevel"
              class="badge-current-level"
              :style="{ color: TIER_COLORS[entry.currentLevel] }"
            >
              {{ levelLabel(entry.currentLevel) }}
            </span>
          </div>
          <p class="badge-description">{{ entry.badge.description }}</p>

          <!-- Tier dots: filled = owned, dashed = next purchase, lock-pattern = beyond per-player max -->
          <div class="tier-dots-row">
            <div class="tier-dots">
              <span
                v-for="lvl in PLAYER_BADGE_LEVELS"
                :key="lvl"
                class="tier-dot"
                :class="{
                  active: dotState(entry, lvl).active,
                  next: dotState(entry, lvl).next,
                  locked: dotState(entry, lvl).locked,
                }"
                :style="dotState(entry, lvl).active ? { background: TIER_COLORS[lvl] } : {}"
                :title="dotState(entry, lvl).locked ? `Locked above ${levelLabel(entry.maxLevel)} for this player` : levelLabel(lvl)"
              />
            </div>
            <span class="max-level-label" :style="{ color: TIER_COLORS[entry.maxLevel] }">
              max {{ levelLabel(entry.maxLevel) }}
            </span>
          </div>

          <div class="badge-card-footer">
            <span v-if="entry.isMaxedForPlayer" class="badge-maxed">
              <Check :size="14" />
              Maxed ({{ levelLabel(entry.maxLevel) }})
            </span>
            <template v-else>
              <span class="badge-cost">
                <Coins :size="13" />
                {{ formatCost(entry.nextCost) }}
              </span>
              <button
                class="badge-purchase-btn"
                :disabled="tokens < (entry.nextCost ?? Infinity) || purchasing !== null || !entry.nextLevel"
                @click="purchase(entry)"
              >
                <ChevronUp v-if="entry.currentLevel" :size="14" />
                <span>
                  {{ purchasing === entry.badge.id
                      ? 'Working...'
                      : tokens < (entry.nextCost ?? Infinity)
                        ? 'Insufficient'
                        : entry.currentLevel
                          ? `Upgrade to ${levelLabel(entry.nextLevel)}`
                          : 'Unlock Bronze' }}
                </span>
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn-close-footer" @click="close">Close</button>
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

.store-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.token-balance {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #FFD700;
  font-weight: 600;
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

.player-summary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.player-summary-label {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 0.65rem;
}

.player-summary-value {
  color: var(--color-text-primary);
  font-weight: 600;
}

.player-summary-divider {
  opacity: 0.4;
}

.store-subtitle {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.empty-store {
  padding: 24px;
  text-align: center;
  color: var(--color-text-secondary);
  background: var(--color-bg-tertiary);
  border: 1px dashed var(--glass-border);
  border-radius: var(--radius-lg);
  font-size: 0.85rem;
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

.tier-dots-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
  transition: background 0.2s ease;
}

.tier-dot.active {
  border-color: rgba(255, 255, 255, 0.4);
}

.tier-dot.next {
  outline: 1px dashed var(--color-primary);
  outline-offset: 1px;
}

.tier-dot.locked {
  background: transparent;
  border-style: dashed;
  border-color: rgba(255, 255, 255, 0.15);
  opacity: 0.5;
}

.max-level-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
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
