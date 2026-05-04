import { getCoachPerks, getEffectiveCoachAttribute } from '@/engine/coaching/CoachPerks'

/**
 * Strictness shapes how a coach pushes players. Effect is asymmetric:
 *  - High-impact role players (≥80 OVR, ≥24 mpg) with low work ethic (≤60)
 *    LOSE satisfaction / morale under a strict coach — they bristle at the demands.
 *  - High work ethic (≥80) players with strong winning motivation GAIN
 *    satisfaction / morale under a strict coach — they appreciate the standard.
 *  - Everyone else takes a small global drag from over-strictness.
 *
 * Strictness is centered at 75 (neutral). Below 75 = lax, above 75 = strict.
 */

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}

function getAvgMinutesPerGame(player) {
  const gp = player?.gamesPlayedThisSeason ?? player?.games_played_this_season ?? 0
  if (gp <= 0) return 0
  const min = player?.minutesPlayedThisSeason ?? player?.minutes_played_this_season ?? 0
  return min / gp
}

function isHighImpactRolePlayer(player) {
  const ovr = player?.overallRating ?? player?.overall_rating ?? 0
  if (ovr < 80) return false
  const mpg = getAvgMinutesPerGame(player)
  return mpg >= 24
}

function getWorkEthic(player) {
  return player?.attributes?.mental?.workEthic ?? 70
}

function getWinningMotivationWeight(player) {
  return player?.motivations?.winning?.weight ?? 0
}

/**
 * Returns a delta in the range roughly [-0.30, +0.20] applied on top of the
 * base coaching satisfaction in MotivationService.
 *
 * @param {object} player
 * @param {object|null} coach
 * @returns {number}
 */
export function strictnessSatisfactionDelta(player, coach) {
  if (!player || !coach) return 0
  const strictness = getEffectiveCoachAttribute(coach, 'strictness')
  const offset = (strictness - 75) / 25 // ~ -3 .. +1 raw
  // Only the over-strict side (offset > 0) penalizes / rewards players asymmetrically.
  const overStrict = Math.max(0, offset)
  // Under-strict (offset < 0) gives a tiny universal lift since players feel relaxed.
  const underStrict = Math.max(0, -offset)

  const we = getWorkEthic(player)
  const winningWeight = getWinningMotivationWeight(player)
  const highImpact = isHighImpactRolePlayer(player)
  const perks = getCoachPerks(coach)
  const soften = clamp(perks.strictnessSoften ?? 0, 0, 1)

  let delta = 0

  // Penalty: low-work-ethic stars hate being pushed
  if (highImpact && we <= 60) {
    delta -= 0.20 * overStrict * (1 - soften)
  }

  // Reward: high-WE + winning-motivated players appreciate the standard
  if (we >= 80 && winningWeight >= 0.6) {
    delta += 0.12 * overStrict
  }

  // Mild global drag from over-strictness for everyone else
  if (!(highImpact && we <= 60) && !(we >= 80 && winningWeight >= 0.6)) {
    delta -= 0.04 * overStrict
  }

  // Tiny lift from a chill / under-strict coach
  delta += 0.04 * underStrict

  return clamp(delta, -0.30, 0.20)
}

/**
 * Returns a weekly morale shift in points, range roughly [-1.2, +0.8].
 * Applied each week in MoraleService.updateWeekly so the effect compounds
 * gradually over a season rather than as a one-shot.
 *
 * @param {object} player
 * @param {object|null} coach
 * @returns {number}
 */
export function strictnessWeeklyMoraleShift(player, coach) {
  if (!player || !coach) return 0
  // Same delta shape as satisfaction, scaled into morale points-per-week.
  const delta = strictnessSatisfactionDelta(player, coach)
  // delta in [-0.30, +0.20]; scale ×4 → roughly [-1.2, +0.8] morale points/week.
  return clamp(delta * 4, -1.5, 1.0)
}
