<script setup>
import { computed } from 'vue'
import TeamOverallBadge from './TeamOverallBadge.vue'

const props = defineProps({
  team: { type: Object, default: null },
  // Average OVR of the healthy roster — passed in by parent so this stays
  // pure. Drives the small badge overlay on the logo.
  teamOverall: { type: Number, default: null },
  // Override the auto-generated "{city} · {CONFERENCE}" subtitle. Null
  // keeps the default.
  subtitle: { type: String, default: null },
})

const conferenceLabel = computed(() => {
  if (!props.team?.conference) return ''
  return props.team.conference === 'east' ? 'EAST' : 'WEST'
})

const computedSubtitle = computed(() => {
  if (props.subtitle != null) return props.subtitle
  const parts = []
  if (props.team?.city) parts.push(props.team.city)
  if (conferenceLabel.value) parts.push(conferenceLabel.value)
  return parts.join(' · ')
})
</script>

<template>
  <section class="team-header">
    <div class="team-header-row">
      <div
        class="team-logo-badge"
        :style="{ backgroundColor: team?.primary_color || '#E85A4F' }"
      >
        {{ team?.abbreviation }}
        <TeamOverallBadge :overall="teamOverall" size="md" />
      </div>
      <div class="team-header-text">
        <p class="team-city">{{ computedSubtitle }}</p>
        <h1 class="team-name">{{ team?.name }}</h1>
      </div>
      <!-- Optional right-side content (e.g., CampaignHomeView's date widget). -->
      <slot name="right" />
    </div>
  </section>
</template>

<style scoped>
/* Single source of truth for the team header used across home / team /
   playoff routes. Same dimensions + breakpoints everywhere. */
.team-header {
  margin-bottom: 20px;
}

.team-header-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.team-logo-badge {
  position: relative;
  overflow: visible;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
  border: 4px solid var(--color-bg-tertiary);
  box-shadow: var(--shadow-md);
}

.team-header-text {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.team-city {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  margin: 0 0 2px 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.team-name {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2.25rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

/* Desktop bump — same breakpoint + values used previously inline in
   CampaignHomeView and TeamManagementView. */
@media (min-width: 767px) {
  .team-logo-badge {
    width: 88px;
    height: 88px;
    font-size: 1.5rem;
  }
  .team-name {
    font-size: 3rem;
  }
  .team-city {
    font-size: 1rem;
  }
}
</style>
