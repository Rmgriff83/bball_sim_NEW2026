import { computed } from 'vue'
import { useTeamStore } from '@/stores/team'
import { scoreUserOffer, interestLevelForScore } from '@/utils/freeAgentInterest'

/**
 * Reactive helper that resolves the user team's context once (team / roster /
 * coach / champion flag) and exposes a `score(player, { salary, years })`
 * function the FA UI can call repeatedly as the user drags a salary slider.
 */
export function useFreeAgentInterest() {
  const teamStore = useTeamStore()

  const userTeamCtx = computed(() => {
    const team = teamStore.team ?? null
    const championYears = (team?.seasonHistory ?? []).filter(h => h.champion).length
    return {
      team,
      roster: teamStore.roster ?? [],
      coach: teamStore.coach ?? null,
      hasChampionship: championYears > 0,
    }
  })

  function score(player, { salary, years }) {
    if (!player) return null
    const ctx = {
      ...userTeamCtx.value,
      isIncumbent: !!(player.previousTeamId && player.previousTeamId === userTeamCtx.value.team?.id),
    }
    return scoreUserOffer(player, { salary, years }, ctx)
  }

  return { score, interestLevelForScore }
}
