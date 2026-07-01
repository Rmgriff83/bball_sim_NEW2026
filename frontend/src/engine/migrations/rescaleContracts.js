import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { baseSalaryForRating, veteranMinSalary, SALARY_CAP } from '@/engine/data/salaryScale'

/**
 * One-shot migration that rebases a pre-existing campaign onto the new (2025-26)
 * salary scale. Campaigns created before the rebase carry salaries AND a stored
 * team salary-cap calibrated to the old $136M cap; left alone, the higher cap +
 * old low salaries would make staying under the cap EASIER, the opposite of the
 * intent — and the finance overview keeps showing the old $136M cap because it
 * reads the value stored on the team record.
 *
 * Two parts:
 *   1. Re-derive every player's `contractSalary` from the shared rating→salary
 *      curve (`baseSalaryForRating`) + the same age factors league generation
 *      uses, rebuilding the per-year escalation array and preserving
 *      years-remaining. Deterministic (no RNG) so it can't churn across reloads.
 *   2. Update each team's stored `salaryCap`/`salary_cap` to the current cap so
 *      the finance overview and cap-space math reflect the new number.
 *
 * Idempotent — guarded by `campaign.settings.salaryCapRebaseDone`. New campaigns
 * are stamped done at creation (they're already on the current scale), so this
 * only ever touches legacy saves. Returns the number of players updated.
 */
export async function rescaleContracts(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) return 0
  if (campaign.settings?.salaryCapRebaseDone) return 0

  // Bring the stored team salary-cap up to the current value (the finance
  // overview reads team.salary_cap before falling back to the constant).
  try {
    const teams = await TeamRepository.getAllForCampaign(campaignId)
    const teamsToFix = (teams ?? []).filter(
      (t) => t.salary_cap !== SALARY_CAP || t.salaryCap !== SALARY_CAP
    )
    if (teamsToFix.length > 0) {
      await TeamRepository.saveBulk(
        teamsToFix.map((t) => ({ ...t, salaryCap: SALARY_CAP, salary_cap: SALARY_CAP }))
      )
    }
  } catch (capErr) {
    console.warn('[rescaleContracts] team cap update failed:', capErr)
  }

  const players = await PlayerRepository.getAllForCampaign(campaignId)
  if (!players || players.length === 0) {
    campaign.settings = { ...(campaign.settings ?? {}), salaryCapRebaseDone: true }
    await CampaignRepository.save(campaign)
    return 0
  }

  const updated = []
  for (const player of players) {
    const overall = player.overallRating ?? player.overall_rating
    if (overall == null) continue
    const age = player.age ?? 27
    const careerSeasons =
      player.careerSeasons ?? player.career_seasons ?? Math.max(0, age - 19)

    let salary = baseSalaryForRating(overall)
    if (age >= 33) salary *= 0.90
    else if (age <= 23) salary *= 0.78
    salary = Math.max(veteranMinSalary({ careerSeasons }), salary)
    salary = Math.round(salary / 10000) * 10000

    const prevDetails = player.contractDetails ?? player.contract_details ?? {}
    const years =
      player.contractYearsRemaining ??
      player.contract_years_remaining ??
      (Array.isArray(prevDetails.salaries) ? prevDetails.salaries.length : 1) ??
      1
    const salaryYears = Math.max(1, Number(years) || 1)

    const salaries = []
    for (let i = 0; i < salaryYears; i++) {
      salaries.push(Math.round((salary * (1 + 0.05 * i)) / 10000) * 10000)
    }
    const details = { ...prevDetails, salaries }

    updated.push({
      ...player,
      campaignId,
      contractSalary: salary,
      contract_salary: salary,
      // Also persist the flat years field in BOTH casings so a legacy save that
      // lacked/diverged on it ends up consistent with the rebuilt salaries array.
      // Without this, downstream re-sign / expiry logic could read a stale or
      // missing year count on pre-2.3 players.
      contractYearsRemaining: salaryYears,
      contract_years_remaining: salaryYears,
      contractDetails: details,
      contract_details: details,
    })
  }

  if (updated.length > 0) {
    await PlayerRepository.saveBulk(updated)
  }

  campaign.settings = { ...(campaign.settings ?? {}), salaryCapRebaseDone: true }
  await CampaignRepository.save(campaign)
  return updated.length
}
