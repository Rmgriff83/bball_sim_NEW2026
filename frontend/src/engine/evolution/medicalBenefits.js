// =============================================================================
// medicalBenefits.js — the single source of truth for the user team's medical
// recovery/prevention benefits (facility level + hired physician perks).
// =============================================================================
// Pure (no stores / no i18n / no I/O) so both the sim path (stores/game.js
// `_getTrainerPerks`) and the injury/recovery modal UI compute IDENTICAL
// numbers from the same inputs: the medical facility level and the hired
// physician record (`campaign.settings.trainer` — legacy key).
//
// Baseline medical-facility benefits need no physician (mirrors how the
// scouting facility grants points per level on its own). Recovery speed is
// deliberately modest and CAPS at Lv3 (+6%) so severe injuries keep realistic
// timelines even stacked with the physician's fast_recovery (worst case +21%,
// not +35%); Lv4/Lv5 shift to injury PREVENTION instead, stacking with the
// physician's injury_prevention perk (up to −20% risk).
// =============================================================================

export const MEDICAL_RECOVERY_BONUS_PER_LEVEL = 0.03
export const MEDICAL_INJURY_RISK_REDUCTION_BY_LEVEL = { 4: 0.05, 5: 0.10 }

/**
 * Full breakdown of the medical benefits for a given facility level +
 * physician record. Every read is old-save tolerant (`??` guards).
 *
 * @param {Object} p
 * @param {number} [p.medicalLevel] - team.facilities.medical (1–5)
 * @param {Object|null} [p.trainer] - campaign.settings.trainer (hired
 *   physician; legacy storage key) or null when none hired
 * @returns {{
 *   medicalLevel: number,
 *   facilityBonus: number,   // recovery speed from facility level alone
 *   perkBonus: number,       // recovery speed from the fast_recovery perk
 *   totalBonus: number,      // facilityBonus + perkBonus (what the sim uses)
 *   perkLocked: boolean,     // physician has fast_recovery but facility too low
 *   perkRequiredLevel: number|null,
 *   injuryRiskReduction: number,
 *   physician: Object|null,
 * }}
 */
export function computeMedicalRecoveryBreakdown({ medicalLevel = 1, trainer = null } = {}) {
  const level = Math.min(5, Number(medicalLevel) || 1)

  const facilityBonus = MEDICAL_RECOVERY_BONUS_PER_LEVEL * Math.max(0, Math.min(3, level) - 1)
  let perkBonus = 0
  let perkLocked = false
  let perkRequiredLevel = null
  let injuryRiskReduction = MEDICAL_INJURY_RISK_REDUCTION_BY_LEVEL[level] ?? 0

  for (const perk of (trainer?.perks || [])) {
    if (perk.key === 'fast_recovery') {
      perkRequiredLevel = perk.requiredLevel ?? null
      if (level >= (perk.requiredLevel ?? 0)) {
        perkBonus += trainer.tier === 4 ? 0.15 : 0.10
      } else {
        perkLocked = true
      }
    }
    if (perk.key === 'injury_prevention' && level >= (perk.requiredLevel ?? 0)) {
      injuryRiskReduction += 0.10
    }
  }

  return {
    medicalLevel: level,
    facilityBonus,
    perkBonus,
    totalBonus: facilityBonus + perkBonus,
    perkLocked,
    perkRequiredLevel,
    injuryRiskReduction,
    physician: trainer ?? null,
  }
}

export default { computeMedicalRecoveryBreakdown }
