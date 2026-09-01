// 30-day "recently traded" cooldown — league-wide rule: a player who changed
// teams in the last TRADE_COOLDOWN_DAYS in-game days cannot be traded again
// (AI-AI trades skip them, AI teams won't propose them, the user's trade
// wizard blocks them). Reads the existing player.tradeLog[] career history
// (stamped on every executed trade path) — no new persisted fields, so old
// saves without a tradeLog simply have no cooldown until their next trade.
//
// This module is deliberately import-free (worker-pure, directly
// node-testable — same pattern as salaryScale.js).

export const TRADE_COOLDOWN_DAYS = 30

/**
 * Most recent trade date ('YYYY-MM-DD') from the player's career trade log,
 * or null when the player has never been traded / has no log (old saves).
 * Takes the max over all entries rather than trusting order.
 */
export function lastTradeDate(player) {
  const log = Array.isArray(player?.tradeLog) ? player.tradeLog : []
  let latest = null
  for (const entry of log) {
    const d = typeof entry?.date === 'string' ? entry.date.slice(0, 10) : null
    if (d && (!latest || d > latest)) latest = d
  }
  return latest
}

/**
 * First date ('YYYY-MM-DD') the player may be traded again, or null when no
 * cooldown applies. UTC math (not setDate on a local Date) so the result is
 * immune to DST off-by-ones and rolls months/years correctly.
 */
export function tradeEligibleDate(player, days = TRADE_COOLDOWN_DAYS) {
  const last = lastTradeDate(player)
  if (!last) return null
  const [y, m, d] = last.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/**
 * True while the player is inside the cooldown window: traded on day D →
 * locked D..D+days-1, tradeable again on D+days. ISO strings compare
 * lexically, so no Date parsing of currentDate is needed.
 */
export function isPlayerTradeLocked(player, currentDate, days = TRADE_COOLDOWN_DAYS) {
  if (!currentDate) return false
  const eligible = tradeEligibleDate(player, days)
  if (!eligible) return false
  return String(currentDate).slice(0, 10) < eligible
}
