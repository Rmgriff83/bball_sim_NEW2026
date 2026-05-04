// Single source of truth for mid-season deadline dates.
// Trade deadline, re-sign deadline, and All-Star selection all currently fall on
// the same day; the "warning" date is the day before, used by simulateToGame to
// pause for user trade/re-sign action while the deadline flags haven't flipped yet.

export function getSeasonDeadlines(year) {
  return {
    tradeDeadline: `${year}-12-15`,
    resignDeadline: `${year}-12-15`,
    allStarDate: `${year}-12-15`,
    tradeDeadlineWarning: `${year}-12-14`,
  }
}

export function isPastTradeDeadline(campaign) {
  return !!campaign?.settings?.trade_deadline_passed
}

export function isPastResignDeadline(campaign) {
  return !!campaign?.settings?.resign_deadline_passed
}
