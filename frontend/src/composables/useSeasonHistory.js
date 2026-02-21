/**
 * Shared utilities for formatting and building season history stats tables.
 * Used by PlayerDetailModal and LeagueView player modal.
 */

/**
 * Convert a single seasonHistory entry's raw totals to per-game averages.
 */
export function formatSeasonHistoryRow(entry) {
  const s = entry.stats || {}
  const gp = s.gamesPlayed || 0
  if (gp === 0) return null

  const avg = (val) => Math.round(((val || 0) / gp) * 10) / 10
  const pct = (made, att) => (att || 0) > 0
    ? Math.round(((made || 0) / att) * 1000) / 10
    : 0

  return {
    year: entry.year,
    team: entry.teamAbbreviation || '—',
    gp,
    ppg: avg(s.points),
    rpg: avg(s.rebounds),
    apg: avg(s.assists),
    spg: avg(s.steals),
    bpg: avg(s.blocks),
    fg_pct: pct(s.fieldGoalsMade, s.fieldGoalsAttempted),
    three_pct: pct(s.threePointersMade, s.threePointersAttempted),
    ft_pct: pct(s.freeThrowsMade, s.freeThrowsAttempted),
    mpg: avg(s.minutesPlayed),
  }
}

/**
 * Build a combined season stats table from past seasonHistory + current season_stats.
 * Returns array sorted by year descending.
 */
export function buildSeasonStatsTable(seasonHistory, currentSeasonStats, currentYear, currentTeamAbbr) {
  const rows = []

  // Past seasons from seasonHistory
  if (Array.isArray(seasonHistory)) {
    for (const entry of seasonHistory) {
      const row = formatSeasonHistoryRow(entry)
      if (row) {
        row.isCurrent = false
        rows.push(row)
      }
    }
  }

  // Current season from season_stats (already per-game averages)
  if (currentSeasonStats && currentYear) {
    const cs = currentSeasonStats
    rows.push({
      year: currentYear,
      team: currentTeamAbbr || '—',
      gp: cs.games_played ?? cs.gamesPlayed ?? 0,
      ppg: cs.ppg ?? 0,
      rpg: cs.rpg ?? 0,
      apg: cs.apg ?? 0,
      spg: cs.spg ?? 0,
      bpg: cs.bpg ?? 0,
      fg_pct: cs.fg_pct ?? cs.fgPct ?? 0,
      three_pct: cs.three_pct ?? cs.threePct ?? 0,
      ft_pct: cs.ft_pct ?? cs.ftPct ?? 0,
      mpg: cs.mpg ?? 0,
      isCurrent: true,
    })
  }

  // Sort by year descending (most recent first)
  rows.sort((a, b) => b.year - a.year)

  return rows
}
