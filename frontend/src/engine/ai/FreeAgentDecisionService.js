// =============================================================================
// FreeAgentDecisionService.js
// =============================================================================
// At the end of the offseason free-agency window, each free agent looks at
// every offer they collected and picks the one that fits them best. Scoring is
// driven by the player's motivation weights + the offering team's outlook
// (record, market, coach, star teammates) and the offer's salary/years.
// =============================================================================

import { calculateRetentionScore, getMarketSize } from './MotivationService'

const SALARY_BANDS = [
  { rating: 90, salary: 40_000_000 },
  { rating: 85, salary: 30_000_000 },
  { rating: 80, salary: 20_000_000 },
  { rating: 75, salary: 10_000_000 },
  { rating: 70, salary: 5_000_000 },
  { rating: 65, salary: 3_000_000 },
]

function expectedSalary(rating) {
  for (const band of SALARY_BANDS) {
    if (rating >= band.rating) return band.salary
  }
  return 2_000_000
}

function getRating(player) {
  return player.overallRating ?? player.overall_rating ?? 70
}

function getAge(player) {
  return player.age ?? 25
}

function getWeight(player, key) {
  return player.motivations?.[key]?.weight ?? 0.5
}

function teamWinPct(team) {
  const wins = team?.wins ?? team?.lastSeasonWins ?? 0
  const losses = team?.losses ?? team?.lastSeasonLosses ?? 0
  const total = wins + losses
  if (total === 0) return 0.5
  return wins / total
}

function ageBasedYearPreference(age) {
  if (age >= 33) return 1
  if (age >= 30) return 2
  if (age >= 27) return 3
  return 4
}

/**
 * Build a motivation-weighted context for `calculateRetentionScore` based on
 * the offering team. The retention scorer expects: teamWinPct, madePlayoffs,
 * teamMarketSize, teamRoster (for star pairing), coach (for coaching fit),
 * yearsWithTeam, contractSalary, expectedSalary, offerSalary.
 */
function buildTeamContext({ team, teamRoster = [], coach = null, isIncumbent = false, hasChampionship = false }) {
  const winPct = teamWinPct(team)
  return {
    teamWinPct: winPct,
    madePlayoffs: !!team?.madePlayoffs || winPct >= 0.55,
    teamMarketSize: getMarketSize(team?.abbreviation),
    teamRoster,
    coach,
    coachStability: !!coach,
    yearsWithTeam: isIncumbent ? 1 : 0,
    hasChampionship,
  }
}

/**
 * Score a single offer for a player. Returns 0–100. Higher = better fit.
 *
 * Reuses MotivationService.calculateRetentionScore for the heavy lifting, then
 * applies a few free-agency-specific adjustments:
 *  - removes the built-in +12 incumbent bonus when the offering team isn't the
 *    player's previous team
 *  - small bonus when contract years matches age-appropriate target
 *  - small bonus when offered salary noticeably beats expected
 */
export function scoreOfferForPlayer(player, offer, teamContext) {
  const expected = expectedSalary(getRating(player))
  const isIncumbent = teamContext.isIncumbent === true

  const retentionContext = buildTeamContext({
    team: teamContext.team,
    teamRoster: teamContext.teamRoster,
    coach: teamContext.coach,
    isIncumbent,
    hasChampionship: teamContext.hasChampionship,
  })
  retentionContext.contractSalary = offer.salary
  retentionContext.expectedSalary = expected
  retentionContext.offerSalary = offer.salary

  let score = calculateRetentionScore(player, retentionContext, offer.salary)

  // calculateRetentionScore unconditionally adds +12 as an "incumbent bonus".
  // For free agency that's only fair when the team actually IS the incumbent.
  if (!isIncumbent) score -= 12

  // Years preference: small bump if offer years roughly matches age target
  const targetYears = ageBasedYearPreference(getAge(player))
  const yearGap = Math.abs((offer.years ?? 1) - targetYears)
  if (yearGap === 0) score += 4
  else if (yearGap === 1) score += 2

  // Money premium beyond expected: extra incentive for money-motivated players
  const salaryRatio = expected > 0 ? offer.salary / expected : 1
  const moneyWeight = getWeight(player, 'money')
  if (salaryRatio > 1.1) {
    score += Math.min(8, (salaryRatio - 1.1) * 20) * moneyWeight
  }

  return Math.round(Math.max(0, Math.min(100, score)))
}

/**
 * Pick the best offer for a player out of all pending offers. Returns
 * { offer, score, reason } or null if no offer clears the minimum threshold.
 *
 * @param {object} player
 * @param {Array} offers - pending Offer objects
 * @param {function} resolveTeamContext - (teamId) => { team, teamRoster, coach, hasChampionship, isIncumbent }
 */
export function pickBestOffer(player, offers, resolveTeamContext) {
  if (!offers || offers.length === 0) return null

  const scored = offers.map(offer => {
    const ctx = resolveTeamContext(offer.teamId, offer) || {}
    const score = scoreOfferForPlayer(player, offer, ctx)
    return { offer, score, ctx }
  })

  // Tie-break: higher score, then higher salary, then longer term, then deterministic team-id
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if ((b.offer.salary ?? 0) !== (a.offer.salary ?? 0)) return (b.offer.salary ?? 0) - (a.offer.salary ?? 0)
    if ((b.offer.years ?? 0) !== (a.offer.years ?? 0)) return (b.offer.years ?? 0) - (a.offer.years ?? 0)
    return String(a.offer.teamId ?? '').localeCompare(String(b.offer.teamId ?? ''))
  })

  const best = scored[0]
  if (best.score < 30) {
    // Settle-for-what's-available fallback. A top FA who didn't get the
    // bidding war they wanted will still take a non-insulting deal — going
    // unsigned for a full year is the worst alternative for any pro. We
    // require the salary to be at least 25% of expected so genuinely
    // insulting offers ($1M to a 90 OVR star) still get rejected; anything
    // above that floor is a prove-it deal a real player would sign.
    const expected = expectedSalary(getRating(player))
    const salaryFloor = expected * 0.25
    if ((best.offer?.salary ?? 0) >= salaryFloor) {
      return {
        offer: best.offer,
        score: best.score,
        reason: 'Settled below market — no competing bids cleared the threshold.',
        shortlist: scored,
      }
    }
    return { offer: null, score: best.score, reason: 'unsigned_low_fit', shortlist: scored }
  }

  return {
    offer: best.offer,
    score: best.score,
    reason: topMotivationReason(player, best.ctx),
    shortlist: scored,
  }
}

/**
 * Identify the strongest motivation that drove the choice, for the wrap-up
 * modal one-line "why" string. Returns a short string, e.g. "Prioritized
 * winning — chose contender LAL".
 */
function topMotivationReason(player, ctx) {
  if (!player.motivations) return null
  let topKey = null
  let topWeight = 0
  for (const [key, data] of Object.entries(player.motivations)) {
    if ((data.weight ?? 0) > topWeight) {
      topWeight = data.weight ?? 0
      topKey = key
    }
  }
  if (!topKey) return null

  const teamAbbr = ctx?.team?.abbreviation ?? ''
  const labelMap = {
    money: `Prioritized money — went where the bag was`,
    winning: `Prioritized winning — chose ${teamAbbr || 'a contender'}`,
    loyalty: `Stayed loyal to ${teamAbbr || 'their team'}`,
    role: `Wanted a clear role — picked ${teamAbbr || 'a fit'}`,
    starPairing: `Wanted to play with stars — joined ${teamAbbr || 'a stacked roster'}`,
    coaching: `Trusted the coaching staff at ${teamAbbr || 'their pick'}`,
    market: `Drawn to the market in ${teamAbbr || 'a bigger city'}`,
    legacy: `Chasing legacy — chose ${teamAbbr || 'a winning culture'}`,
  }
  return labelMap[topKey] || null
}
