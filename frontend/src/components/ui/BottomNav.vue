<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { usePlayoffStore } from '@/stores/playoff'
import { useCampaignStore } from '@/stores/campaign'
import { useTeamStore } from '@/stores/team'
import { Home, Users, Trophy, Play, Binoculars } from 'lucide-vue-next'

const props = defineProps({
  campaignId: {
    type: [String, Number],
    required: true
  }
})

const route = useRoute()
const playoffStore = usePlayoffStore()
const campaignStore = useCampaignStore()
const teamStore = useTeamStore()

const scoutingPoints = computed(() => {
  return campaignStore.currentCampaign?.settings?.scoutingPoints ?? 0
})

// "Training ready" indicator — mirrors the desktop top-nav. Drives a small
// green dot on the GM tab when the user's active player-training session
// has completed. Re-evaluates every 30s.
const _trainTick = ref(Date.now())
let _trainTickHandle = null
const trainingReadyForClaim = computed(() => {
  void _trainTick.value
  const t = teamStore.coach?.activeTraining
  if (!t?.endsAt) return false
  return new Date(t.endsAt).getTime() <= Date.now()
})
onMounted(() => {
  if (_trainTickHandle == null) {
    _trainTickHandle = setInterval(() => { _trainTick.value = Date.now() }, 30 * 1000)
  }
})
onUnmounted(() => {
  if (_trainTickHandle != null) {
    clearInterval(_trainTickHandle)
    _trainTickHandle = null
  }
})

const seasonPhase = computed(() => {
  const c = campaignStore.currentCampaign
  return c?.settings?.season_phase ?? c?.settings?.seasonPhase ?? c?.phase ?? 'regular_season'
})

// Scouting stays available through the postseason and the entire offseason —
// including the free-agency window AND the draft phase itself, since that's
// exactly when prospects matter and the user wants to spend scout points right
// before drafting. It's only hidden once THIS offseason's rookie draft is
// completed, reopening when the next regular season starts (a new gameYear with
// no completed draft).
const hideScout = computed(() => {
  const c = campaignStore.currentCampaign
  const gameYear = c?.gameYear ?? 1
  return c?.[`rookieDraftCompleted_${gameYear}`] === true
})

// No games are playable during the offseason — hide the Play tab there.
const isOffseason = computed(() => {
  const p = seasonPhase.value
  return p === 'offseason' || p === 'offseason_free_agency' || p === 'offseason_draft'
})

const navItems = computed(() => {
  const showPlayoffs = playoffStore.isInPlayoffs && seasonPhase.value !== 'regular_season'
  const thirdTab = showPlayoffs
    ? {
        name: 'playoffs',
        to: `/campaign/${props.campaignId}/playoffs`,
        routeName: 'playoffs',
        icon: 'trophy'
      }
    : {
        name: 'league',
        to: `/campaign/${props.campaignId}/league`,
        routeName: 'league',
        icon: 'trophy'
      }

  return [
    {
      name: 'home',
      to: `/campaign/${props.campaignId}`,
      routeName: 'campaign-home',
      icon: 'home'
    },
    {
      name: 'gm',
      to: `/campaign/${props.campaignId}/team`,
      routeName: 'team-management',
      icon: 'users'
    },
    thirdTab,
    hideScout.value ? null : {
      name: 'scout',
      to: `/campaign/${props.campaignId}/scouting`,
      routeName: 'scouting',
      icon: 'binoculars'
    },
    isOffseason.value ? null : {
      name: 'play',
      to: `/campaign/${props.campaignId}/play`,
      routeName: 'game',
      icon: 'play',
      highlight: true
    }
  ].filter(Boolean)
})

function isActive(routeName) {
  // Handle play nav item - active when on game or play route
  if (routeName === 'game') {
    return route.name === 'game' || route.name === 'play'
  }
  if (routeName === 'playoffs') {
    return route.name === 'playoffs'
  }
  return route.name === routeName
}
</script>

<template>
  <nav class="bottom-nav" data-tour="home-bottom-nav">
    <router-link
      v-for="item in navItems"
      :key="item.name"
      :to="item.to"
      class="bottom-nav-item"
      :class="{ active: isActive(item.routeName), highlight: item.highlight }"
    >
      <!-- Home Icon -->
      <Home
        v-if="item.icon === 'home'"
        class="bottom-nav-icon"
        :size="24"
        :fill="isActive(item.routeName) ? 'currentColor' : 'none'"
      />

      <!-- Users Icon (GM View) — small green dot when a player training
           session is ready to claim. Mirrors the desktop nav indicator. -->
      <template v-else-if="item.icon === 'users'">
        <Users
          class="bottom-nav-icon"
          :size="24"
          :fill="isActive(item.routeName) ? 'currentColor' : 'none'"
        />
        <span v-if="trainingReadyForClaim" class="train-ready-dot" :title="$t('Player training ready to claim')"></span>
      </template>

      <!-- Trophy Icon -->
      <Trophy
        v-else-if="item.icon === 'trophy'"
        class="bottom-nav-icon"
        :size="24"
        :fill="isActive(item.routeName) ? 'currentColor' : 'none'"
      />

      <!-- Binoculars Icon (Scout) -->
      <template v-else-if="item.icon === 'binoculars'">
        <Binoculars
          class="bottom-nav-icon"
          :size="24"
          fill="none"
        />
        <span v-if="scoutingPoints > 0" class="scout-badge">{{ scoutingPoints }}</span>
      </template>

      <!-- Play Button (special styling) -->
      <template v-else-if="item.icon === 'play'">
        <div class="play-btn">
          <Play class="play-btn-icon" :size="20" fill="currentColor" />
        </div>
      </template>
    </router-link>
  </nav>
</template>

<style scoped>
.bottom-nav {
  position: fixed;
  /* Float above the home-indicator safe area on devices that have one (iOS),
     and stay flush with the bottom on devices that don't (env() = 0). The
     strip below the nav shows the page background — common pattern in native
     iOS apps and now consistent across all mobile clients. */
  bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom));
  /* Width-matched to the home view's content cards so the nav looks like a
     paired strip rather than a narrower floating pill. Home (and the rest
     of the campaign views) use `.campaign-home { max-width: 1024px;
     padding: 8px 16px; }` — net inner width = viewport - 32px on phones,
     capped at 1024 - 32 = 992px on tablets. Mirror those exact values. */
  left: 50%;
  right: auto;
  transform: translateX(-50%);
  width: calc(100% - 32px);
  max-width: 992px;
  z-index: 50;
  display: flex;
  justify-content: space-around;
  /* Stretch items to the full nav height, then center content inside each
     item via the rules below. Avoids the subpixel misalignment of
     align-items: center with items of varying intrinsic heights. */
  align-items: stretch;
  height: 70px;
  border-radius: 22px;
  border: 1px solid var(--glass-border);
  /* Translucent + backdrop blur for the glass effect. The 0.6 opacity leans
     on the blur for legibility, closer to Apple's thinMaterial. */
  background: rgba(37, 32, 48, 0.6);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  backdrop-filter: saturate(180%) blur(20px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}

/* Light-mode glass: whiter + softer shadow (a dark shadow reads as a harsh
   bar against a white page). */
[data-theme="light"] .bottom-nav {
  background: rgba(255, 255, 255, 0.55);
  box-shadow: 0 8px 24px rgba(45, 40, 56, 0.12);
}

/* Nebula effect */
.bottom-nav::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.05) 0%, transparent 40%);
  pointer-events: none;
  z-index: 0;
}

[data-theme="light"] .bottom-nav::before {
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.12) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.08) 0%, transparent 40%);
}

.bottom-nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 24px;
  color: var(--color-text-tertiary);
  text-decoration: none;
  transition: color 0.2s ease;
  -webkit-tap-highlight-color: transparent;
  position: relative;
  z-index: 1;
}

.bottom-nav-item:hover {
  color: var(--color-text-secondary);
}

.bottom-nav-item.active {
  color: var(--color-primary);
}

.bottom-nav-item.highlight {
  padding: 0;
}

.play-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  padding: 0 20px;
  border-left: 1px solid var(--glass-border);
  color: var(--color-primary);
}

.play-btn-icon {
  width: 20px;
  height: 20px;
}

.bottom-nav-icon {
  width: 24px;
  height: 24px;
}

.scout-badge {
  position: absolute;
  top: 2px;
  right: 8px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--gradient-cosmic);
  color: black;
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

/* Player-training "ready to claim" indicator on the GM tab. Single dot
   (there's only ever one active training at a time), positioned mirror
   to .scout-badge. */
.train-ready-dot {
  position: absolute;
  top: 4px;
  right: 18px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.25);
}

/* Hide on desktop */
@media (min-width: 1024px) {
  .bottom-nav {
    display: none;
  }
}
</style>

