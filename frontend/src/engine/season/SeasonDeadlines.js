// Single source of truth for mid-season deadline dates.
// Trade deadline, re-sign deadline, and All-Star selection all currently fall on
// the same day; the "warning" date is one week before, used to pause every sim
// path (multi-sim, single-sim, live play) so the user has time to wrap up
// trades and re-signings before the deadline flags flip.

export const FREE_AGENCY_DURATION_DAYS = 14

export function getSeasonDeadlines(year) {
  return {
    tradeDeadline: `${year}-12-15`,
    resignDeadline: `${year}-12-15`,
    allStarDate: `${year}-12-15`,
    tradeDeadlineWarning: `${year}-12-08`,
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
