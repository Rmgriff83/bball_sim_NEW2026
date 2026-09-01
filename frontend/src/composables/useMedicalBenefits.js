// =============================================================================
// useMedicalBenefits — reactive medical-benefits breakdown for the injury /
// recovery modals. Wraps the pure computeMedicalRecoveryBreakdown (the same
// math the sim applies in stores/game.js `_getTrainerPerks`) with the campaign
// + team data: team-store fast path when the user's team is loaded, IDB
// fallback otherwise (mirrors useScoutReportToast's recipe).
// =============================================================================

import { ref, computed, watchEffect } from 'vue'
import { useCampaignStore } from '@/stores/campaign'
import { useTeamStore } from '@/stores/team'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { computeMedicalRecoveryBreakdown } from '@/engine/evolution/medicalBenefits'

/** Calendar days an injury effectively lasts under a recovery-speed bonus. */
export function effectiveDaysOut(daysOut, totalBonus) {
  const days = Number(daysOut) || 0
  const bonus = Math.max(0, Number(totalBonus) || 0)
  if (days <= 0) return 0
  return Math.ceil(days / (1 + bonus))
}

/** Whole days shaved off the rolled duration by the recovery-speed bonus. */
export function daysSaved(daysOut, totalBonus) {
  const days = Number(daysOut) || 0
  if (days <= 0) return 0
  return days - effectiveDaysOut(days, totalBonus)
}

export function useMedicalBenefits() {
  const campaignStore = useCampaignStore()
  const teamStore = useTeamStore()

  // Fallback medical level fetched from IDB when the team store doesn't hold
  // the user's team (e.g. SimPauseModal mounted before a team-tab visit).
  const fallbackLevel = ref(null)

  watchEffect(async () => {
    const camp = campaignStore.currentCampaign
    if (!camp?.id || !camp?.teamId) return
    if (teamStore.team && String(teamStore.team.id) === String(camp.teamId)) return
    try {
      const team = await TeamRepository.get(camp.id, camp.teamId)
      fallbackLevel.value = team?.facilities?.medical ?? 1
    } catch {
      fallbackLevel.value = null
    }
  })

  const medicalBreakdown = computed(() => {
    const camp = campaignStore.currentCampaign
    const storeLevel = teamStore.team && String(teamStore.team.id) === String(camp?.teamId)
      ? teamStore.team.facilities?.medical
      : null
    return computeMedicalRecoveryBreakdown({
      medicalLevel: storeLevel ?? fallbackLevel.value ?? 1,
      trainer: camp?.settings?.trainer ?? null,
    })
  })

  const campaignId = computed(() => campaignStore.currentCampaign?.id ?? null)

  return { medicalBreakdown, campaignId }
}
