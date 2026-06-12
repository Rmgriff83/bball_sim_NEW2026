/**
 * Shared utilities for formatting and building season history stats tables.
 * Used by PlayerDetailModal and LeagueView player modal.
 */

/**
 * Convert a single seasonHistory entry to the per-game shape the UI renders.
 *
 * Handles two on-disk shapes:
 *  - Raw form (locally archived): `{ year, teamAbbreviation, stats: { gamesPlayed, points, rebounds, ... } }`
 *  - Compact form (post-sync round-trip): `{ _compact: true, year, teamAbbreviation, gamesPlayed, ppg, rpg, apg, ..., fgPct, threePct, ftPct }`
 *
 * The sync layer compresses raw entries into compact form on push (so the
 * players chunk stays under PHP's post_max_size). On pull, compact entries
 * come back unchanged — so this formatter must recognize both forms or the
 * entire historical stats table goes empty after the first cloud sync.
 */
export function formatSeasonHistoryRow(entry) {
  if (!entry) return null

  // Compact form — fields are already per-game averages.
  if (entry._compact === true || (entry.gamesPlayed !== undefined && entry.stats === undefined)) {
    const gp = entry.gamesPlayed || 0
    if (gp === 0) return null
    return {
      year: entry.year,
      team: entry.teamAbbreviation || '—',
      gp,
      ppg: entry.ppg ?? 0,
      rpg: entry.rpg ?? 0,
      apg: entry.apg ?? 0,
      spg: entry.spg ?? 0,
      bpg: entry.bpg ?? 0,
      fg_pct: entry.fgPct ?? 0,
      three_pct: entry.threePct ?? 0,
      ft_pct: entry.ftPct ?? 0,
      mpg: entry.mpg ?? 0,
    }
  }

  // Raw form — divide cumulative totals by games played.
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
 *
 * When `currentSeasonPlayoffStats` is provided and the player has played at
 * least one playoff game, the current-season row gets a `playoffStats` field
 * attached. The detail-modal template renders that as an indented sub-row
 * beneath the parent. Archived prior seasons never get this — we don't
 * persist per-player playoff history.
 */
export function buildSeasonStatsTable(
  seasonHistory,
  currentSeasonStats,
  currentYear,
  currentTeamAbbr,
  currentSeasonPlayoffStats = null
) {
  const rows = []
  const yearsSeen = new Set()

  // Past seasons from seasonHistory
  if (Array.isArray(seasonHistory)) {
    for (const entry of seasonHistory) {
      const row = formatSeasonHistoryRow(entry)
      if (row) {
        row.isCurrent = false
        rows.push(row)
        yearsSeen.add(row.year)
      }
    }
  }

  // Current season from season_stats (already per-game averages).
  // Skip if seasonHistory already contains an entry for this year — happens
  // during offseason when the just-ended season has been archived but
  // season_stats hasn't been reset yet.
  if (currentSeasonStats && currentYear && !yearsSeen.has(currentYear)) {
    const cs = currentSeasonStats
    const currentRow = {
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
    }

    const ps = currentSeasonPlayoffStats
    const playoffGp = ps?.games_played ?? ps?.gamesPlayed ?? 0
    if (ps && playoffGp > 0) {
      currentRow.playoffStats = {
        team: currentTeamAbbr || '—',
        gp: playoffGp,
        ppg: ps.ppg ?? 0,
        rpg: ps.rpg ?? 0,
        apg: ps.apg ?? 0,
        spg: ps.spg ?? 0,
        bpg: ps.bpg ?? 0,
        fg_pct: ps.fg_pct ?? ps.fgPct ?? 0,
        three_pct: ps.three_pct ?? ps.threePct ?? 0,
        ft_pct: ps.ft_pct ?? ps.ftPct ?? 0,
        mpg: ps.mpg ?? 0,
      }
    }

    rows.push(currentRow)
  }

  // Sort by year descending (most recent first)
  rows.sort((a, b) => b.year - a.year)

  return rows
}
