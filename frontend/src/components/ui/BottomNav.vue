<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { usePlayoffStore } from '@/stores/playoff'
import { Home, Users, Trophy, Play } from 'lucide-vue-next'

const props = defineProps({
  campaignId: {
    type: [String, Number],
    required: true
  }
})

const route = useRoute()
const playoffStore = usePlayoffStore()

const navItems = computed(() => {
  const thirdTab = playoffStore.isInPlayoffs
    ? {
        name: 'playoffs',
        label: 'PLAYOFFS',
        to: `/campaign/${props.campaignId}/playoffs`,
        routeName: 'playoffs',
        icon: 'trophy'
      }
    : {
        name: 'league',
        label: 'LEAGUE',
        to: `/campaign/${props.campaignId}/league`,
        routeName: 'league',
        icon: 'trophy'
      }

  return [
    {
      name: 'home',
      label: 'HOME',
      to: `/campaign/${props.campaignId}`,
      routeName: 'campaign-home',
      icon: 'home'
    },
    {
      name: 'gm',
      label: 'GM VIEW',
      to: `/campaign/${props.campaignId}/team`,
      routeName: 'team-management',
      icon: 'users'
    },
    thirdTab,
    {
      name: 'play',
      label: 'PLAY',
      to: `/campaign/${props.campaignId}/play`,
      routeName: 'game',
      icon: 'play',
      highlight: true
    }
  ]
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
  <nav class="bottom-nav">
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

      <!-- Users Icon -->
      <Users
        v-else-if="item.icon === 'users'"
        class="bottom-nav-icon"
        :size="24"
        :fill="isActive(item.routeName) ? 'currentColor' : 'none'"
      />

      <!-- Trophy Icon -->
      <Trophy
        v-else-if="item.icon === 'trophy'"
        class="bottom-nav-icon"
        :size="24"
        :fill="isActive(item.routeName) ? 'currentColor' : 'none'"
      />

      <!-- Play Button (special styling) -->
      <template v-else-if="item.icon === 'play'">
        <div class="play-btn">
          <Play class="play-btn-icon" :size="20" fill="currentColor" />
          <span class="play-btn-label">{{ item.label }}</span>
        </div>
      </template>

      <span v-if="!item.highlight" class="bottom-nav-label">{{ item.label }}</span>
    </router-link>
  </nav>
</template>

<style scoped>
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
  display: flex;
  justify-content: space-around;
  align-items: center;
  height: 70px;
  background: var(--color-bg-secondary);
  border-top: 1px solid var(--glass-border);
  padding-bottom: env(safe-area-inset-bottom);
  overflow: hidden;
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
  gap: 4px;
  padding: 8px 24px;
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

.play-btn-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.bottom-nav-icon {
  width: 24px;
  height: 24px;
}

.bottom-nav-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
}

/* Hide on desktop */
@media (min-width: 1024px) {
  .bottom-nav {
    display: none;
  }
}
</style>
