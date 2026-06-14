// Single source of truth for mid-season deadline dates.
// Trade deadline, re-sign deadline, and All-Star selection all currently fall on
// the same day; the "warning" date is one week before, used to pause every sim
// path (multi-sim, single-sim, live play) so the user has time to wrap up
// trades and re-signings before the deadline flags flip.
//
// The 82-game regular season tips off Oct 21 (year N) and runs into April
// (year N+1). The mid-season deadline lands at ~2/3 of the way through, which
// matches real NBA timing (Feb 5, 2026 was the actual NBA trade deadline).

export const FREE_AGENCY_DURATION_DAYS = 14

export function getSeasonDeadlines(year) {
  const nextYear = year + 1
  return {
    tradeDeadline: `${nextYear}-02-05`,
    resignDeadline: `${nextYear}-02-05`,
    allStarDate: `${nextYear}-02-05`,
    tradeDeadlineWarning: `${nextYear}-01-29`,
  }
}

export function isPastTradeDeadline(campaign) {
  return !!campaign?.settings?.trade_deadline_passed
}

export function isPastResignDeadline(campaign) {
  return !!campaign?.settings?.resign_deadline_passed
}

export function isInFreeAgencyPeriod(campaign) {
  return campaign?.phase === 'offseason_free_agency'
}

export function getFreeAgencyEndDate(startDate) {
  const start = startDate instanceof Date ? new Date(startDate) : new Date(startDate)
  start.setDate(start.getDate() + FREE_AGENCY_DURATION_DAYS)
  return start
}
