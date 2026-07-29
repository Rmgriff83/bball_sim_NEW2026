// Shared, presentational helpers for the trade UI. Extracted so the wizard
// (TradeCenter.vue) and the enriched Trade Partner components
// (TradePartnerStep.vue / TradePartnerCard.vue) render assets identically from
// one source. Framework-free / import-free — safe to unit-test in isolation.

// Convert a player's rating (or a pick's projected slot) into a 1-5 star level.
// Mirrors the thresholds the wizard has always used so star counts stay stable.
export function getAssetStars(asset) {
  const isPlayer = asset.type === 'player' || asset.overallRating != null || asset.overall_rating != null
  if (isPlayer) {
    const rating = asset.overallRating ?? asset.overall_rating ?? 75
    if (rating >= 88) return 5
    if (rating >= 82) return 4
    if (rating >= 76) return 3
    if (rating >= 70) return 2
    return 1
  }
  const projected = asset.projectedPosition ?? asset.projected_position ?? 30
  if (projected <= 5) return 5
  if (projected <= 14) return 4
  if (projected <= 30) return 3
  if (projected <= 45) return 2
  return 1
}

export function getPositionColor(position) {
  const colors = {
    PG: '#3B82F6',
    SG: '#10B981',
    SF: '#F59E0B',
    PF: '#EF4444',
    C: '#8B5CF6',
  }
  return colors[position] || '#6B7280'
}

export function formatContractYears(years) {
  if (!years || years <= 0) return 'Expiring'
  if (years === 1) return '1 yr'
  return `${years} yrs`
}

// DEPRECATED — hardcoded 2025-era base; use pickCalendarYear with the
// campaign so 2026-start campaigns anchor correctly. Kept for any stale
// caller (renders the old labels rather than crashing).
export function formatPickYear(year) {
  if (year == null) return ''
  return year < 100 ? 2024 + year : year
}

/**
 * Calendar year of a draft pick. Stored pick years are a GAME-YEAR counter
 * (1, 2, 3…) — load-bearing for ownership matching — so display derives the
 * calendar from the campaign: the year-N pick is exercised in the draft at
 * the end of season (currentSeasonYear + N − gameYear), i.e. calendar
 * (currentSeasonYear − gameYear + 1 + N). A season-2026 campaign's first
 * draft is 2027, matching the prospect class's `currentSeasonYear + 1`
 * labeling. Values ≥ 100 are already absolute and pass through.
 */
export function pickCalendarYear(year, campaign) {
  if (year == null) return ''
  if (year >= 100) return year
  const seasonYear = campaign?.currentSeasonYear ?? campaign?.current_season_year ?? 2025
  const gameYear = campaign?.gameYear ?? campaign?.game_year ?? 1
  return seasonYear - gameYear + 1 + year
}

// Build a per-game stats object the PlayerDetailModal can render. Matches the
// shape produced by the team store's _attachSeasonStats (lifted from
// TradingBlockTab so other-team players show the same season table).
export function buildPerGameStats(raw) {
  if (!raw || !raw.gamesPlayed) return null
  const gp = raw.gamesPlayed
  const round1 = (n) => Math.round((n / gp) * 10) / 10
  const pct = (made, att) => (att > 0 ? Math.round((made / att) * 1000) / 10 : 0)
  const fgPct = pct(raw.fieldGoalsMade, raw.fieldGoalsAttempted)
  const threePct = pct(raw.threePointersMade, raw.threePointersAttempted)
  const ftPct = pct(raw.freeThrowsMade, raw.freeThrowsAttempted)
  return {
    games_played: gp,
    gamesPlayed: gp,
    ppg: round1(raw.points),
    rpg: round1(raw.rebounds),
    apg: round1(raw.assists),
    spg: round1(raw.steals),
    bpg: round1(raw.blocks),
    mpg: round1(raw.minutesPlayed),
    fg_pct: fgPct, fgPct,
    three_pct: threePct, threePct,
    ft_pct: ftPct, ftPct,
    points: raw.points,
    rebounds: raw.rebounds,
    assists: raw.assists,
    steals: raw.steals,
    blocks: raw.blocks,
    turnovers: raw.turnovers,
    minutesPlayed: raw.minutesPlayed,
    fgm: raw.fieldGoalsMade,
    fga: raw.fieldGoalsAttempted,
    fg3m: raw.threePointersMade,
    fg3a: raw.threePointersAttempted,
    ftm: raw.freeThrowsMade,
    fta: raw.freeThrowsAttempted,
  }
}

// Compact PPG/RPG/APG line for a roster/block row. Returns null when the player
// hasn't logged a game yet so callers can hide the line.
export function getStatLine(raw) {
  if (!raw || !raw.gamesPlayed) return null
  const gp = raw.gamesPlayed
  return {
    ppg: ((raw.points || 0) / gp).toFixed(1),
    rpg: ((raw.rebounds || 0) / gp).toFixed(1),
    apg: ((raw.assists || 0) / gp).toFixed(1),
  }
}
