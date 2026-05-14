// Team overall rating — aggregate average overall of the team's available
// roster, excluding retired, free-agent, and currently injured players.
// Returns null when there's nothing to average (don't render a badge).

export function computeTeamOverall(players) {
  if (!Array.isArray(players)) return null
  let sum = 0
  let count = 0
  for (const p of players) {
    if (!p) continue
    if (p.isRetired || p.is_retired) continue
    if (p.isFreeAgent === 1 || p.is_free_agent === 1) continue
    if (p.isInjured || p.is_injured) continue
    const ovr = p.overallRating ?? p.overall_rating
    if (typeof ovr !== 'number' || ovr <= 0) continue
    sum += ovr
    count += 1
  }
  if (count === 0) return null
  return Math.round(sum / count)
}
