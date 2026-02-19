/**
 * Client-side AI Draft Logic
 * Scores each available player for the picking team and selects using weighted random.
 */

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

// Badge synergy pairs from the 18 seeded BadgeSynergy definitions
const SYNERGY_PAIRS = [
  ['pick_and_roll_maestro', 'brick_wall'],
  ['pick_and_roll_maestro', 'lob_city_finisher'],
  ['dimer', 'catch_and_shoot'],
  ['floor_general', 'corner_specialist'],
  ['lob_city_passer', 'lob_city_finisher'],
  ['defensive_leader', 'rim_protector'],
  ['clamps', 'rim_protector'],
  ['interceptor', 'break_starter'],
  ['rebound_chaser', 'box'],
  ['putback_boss', 'worm'],
  ['ankle_breaker', 'space_creator'],
  ['needle_threader', 'slithery_finisher'],
  ['contact_finisher', 'posterizer'],
  ['giant_slayer', 'floater_specialist'],
  ['floor_general', 'defensive_leader'],
  ['brick_wall', 'pick_dodger'],
]

function calculateAge(birthDate) {
  if (!birthDate) return 25
  const birth = new Date(birthDate)
  const now = new Date('2025-10-21') // Game start date
  let age = now.getFullYear() - birth.getFullYear()
  const monthDiff = now.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age--
  }
  return age
}

function getPositionCounts(teamPicks) {
  const counts = {}
  POSITIONS.forEach(p => counts[p] = 0)
  for (const pick of teamPicks) {
    if (pick.position && counts[pick.position] !== undefined) {
      counts[pick.position]++
    }
    // Count secondary positions as partial fills
    if (pick.secondaryPosition && counts[pick.secondaryPosition] !== undefined) {
      // Don't double count, secondary provides coverage but not a full slot
    }
  }
  return counts
}

function getTeamBadgeIds(teamPicks) {
  const badgeIds = new Set()
  for (const pick of teamPicks) {
    if (pick.badges) {
      for (const badge of pick.badges) {
        if (badge.id) badgeIds.add(badge.id)
      }
    }
  }
  return badgeIds
}

/**
 * Score a player for a specific team based on multiple factors.
 */
function scorePlayer(player, teamPicks, currentRound, totalRounds) {
  let score = 0

  const ovr = player.overallRating || 75
  const pot = player.potentialRating || ovr
  const age = calculateAge(player.birthDate)
  const position = player.position || 'SF'
  const secondaryPos = player.secondaryPosition || null

  // 1. Base rating (0-40)
  score += ovr * 0.40

  // 2. Positional need (0-15)
  const posCounts = getPositionCounts(teamPicks)
  const posCount = posCounts[position] || 0
  if (posCount === 0) score += 15
  else if (posCount === 1) score += 8
  else if (posCount === 2) score += 3

  // 3. Potential upside (0-8)
  const roundPct = currentRound / totalRounds
  let roundMult
  if (roundPct <= 0.33) roundMult = 0.3 // Early rounds: value proven talent
  else if (roundPct <= 0.66) roundMult = 0.5 // Mid rounds: balanced
  else roundMult = 0.8 // Late rounds: swing for upside
  const potentialUpside = Math.min(8, (pot - ovr) * roundMult)
  score += Math.max(0, potentialUpside)

  // 4. Badge synergy (0-6)
  const teamBadges = getTeamBadgeIds(teamPicks)
  const playerBadgeIds = (player.badges || []).map(b => b.id)
  let synergyPoints = 0
  for (const [b1, b2] of SYNERGY_PAIRS) {
    const playerHasOne = playerBadgeIds.includes(b1) || playerBadgeIds.includes(b2)
    const teamHasOther = (playerBadgeIds.includes(b1) && teamBadges.has(b2)) ||
                         (playerBadgeIds.includes(b2) && teamBadges.has(b1))
    if (playerHasOne && teamHasOther) {
      synergyPoints += 2
    }
  }
  score += Math.min(6, synergyPoints)

  // 5. Age premium (-2 to +5)
  if (age <= 23) score += 5
  else if (age <= 26) score += 3
  else if (age <= 29) score += 1
  else score -= 2

  // 6. Secondary position fill (0-3)
  if (secondaryPos && posCounts[secondaryPos] !== undefined && posCounts[secondaryPos] === 0) {
    score += 3
  }

  // 7. Random jitter (±3)
  score += (Math.random() * 6) - 3

  return score
}

/**
 * Select a player for an AI team to draft.
 * Returns the selected player object from availablePlayers.
 */
export function selectAIPick(availablePlayers, teamPicks, currentRound, totalRounds = 15) {
  if (availablePlayers.length === 0) return null

  // Score all available players
  const scored = availablePlayers.map(player => ({
    player,
    score: scorePlayer(player, teamPicks, currentRound, totalRounds),
  }))

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  // Weighted random among top 3 (70/20/10%)
  const weights = [0.70, 0.20, 0.10]
  const candidates = scored.slice(0, Math.min(3, scored.length))
  const roll = Math.random()

  let cumulative = 0
  for (let i = 0; i < candidates.length; i++) {
    cumulative += weights[i] || 0
    if (roll < cumulative) {
      return candidates[i].player
    }
  }

  // Fallback to top pick
  return candidates[0].player
}

// =============================================================================
// ROOKIE DRAFT AI — direction-aware pick selection
// =============================================================================

/**
 * Score a rookie prospect for an AI team based on team direction.
 *
 * @param {Object} player - Rookie prospect
 * @param {Array} teamRoster - Existing roster + previously drafted rookies
 * @param {string} direction - 'rebuilding' | 'ascending' | 'win_now' | 'title_contender'
 * @param {number} pickNumber - Overall pick number (1-60)
 * @param {number} round - 1 or 2
 * @returns {number} Score
 */
function scoreRookiePlayer(player, teamRoster, direction, pickNumber, round) {
  let score = 0

  const ovr = player.overallRating || 60
  const pot = player.potentialRating || ovr
  const age = player.age || 20
  const position = player.position || 'SF'
  const potentialGap = pot - ovr
  const workEthic = player.attributes?.mental?.workEthic ?? 70

  // Direction-specific base scoring
  if (direction === 'rebuilding') {
    // Ceiling-weighted: potential matters more
    score += pot * 0.25 + ovr * 0.15
    // Heavy upside bonus
    score += Math.min(12, potentialGap * 0.6)
    // Age premium for youngest players
    if (age === 19) score += 5
    else if (age === 20) score += 3
    else if (age === 21) score += 1
  } else if (direction === 'title_contender' || direction === 'win_now') {
    // Floor-weighted: NBA-readiness matters
    score += ovr * 0.30 + pot * 0.10
    // NBA-readiness bonus
    score += Math.min(10, (ovr - 60) * 0.5)
    // Capped upside
    score += Math.min(direction === 'title_contender' ? 4 : 6, potentialGap * 0.3)
    // Age less important for contenders
    if (age <= 21) score += 1
  } else {
    // Ascending — balanced
    score += ovr * 0.20 + pot * 0.20
    // Moderate upside bonus
    score += Math.min(10, potentialGap * 0.45)
    // Moderate age premium
    if (age === 19) score += 4
    else if (age === 20) score += 2
    else if (age === 21) score += 1
  }

  // Round 2 shift: extra upside swing
  if (round === 2) {
    score += Math.min(5, potentialGap * 0.2)
  }

  // Work ethic bonus (0-5)
  score += Math.max(0, (workEthic - 60) * 0.15)

  // Badge synergy (0-6)
  const teamBadges = getTeamBadgeIds(teamRoster)
  const playerBadgeIds = (player.badges || []).map(b => b.id)
  let synergyPoints = 0
  for (const [b1, b2] of SYNERGY_PAIRS) {
    const playerHasOne = playerBadgeIds.includes(b1) || playerBadgeIds.includes(b2)
    const teamHasOther = (playerBadgeIds.includes(b1) && teamBadges.has(b2)) ||
                         (playerBadgeIds.includes(b2) && teamBadges.has(b1))
    if (playerHasOne && teamHasOther) {
      synergyPoints += 2
    }
  }
  score += Math.min(6, synergyPoints)

  // Positional need (0-15)
  const posCounts = getPositionCounts(teamRoster)
  const posCount = posCounts[position] || 0
  const needWeight = (direction === 'title_contender' || direction === 'win_now') ? 1.2 : 1.0
  if (posCount === 0) score += 15 * needWeight
  else if (posCount <= 2) score += 8 * needWeight
  else if (posCount <= 3) score += 3 * needWeight

  // Random jitter (±3)
  score += (Math.random() * 6) - 3

  return score
}

/**
 * Select a rookie for an AI team to draft, using direction-aware strategy.
 *
 * @param {Array} availablePlayers - Remaining undrafted rookies
 * @param {Array} teamRoster - Existing roster for the picking team
 * @param {string} teamDirection - 'rebuilding' | 'ascending' | 'win_now' | 'title_contender'
 * @param {number} pickNumber - Overall pick number (1-60)
 * @param {number} round - 1 or 2
 * @returns {Object|null} Selected player
 */
export function selectRookieDraftPick(availablePlayers, teamRoster, teamDirection, pickNumber, round) {
  if (availablePlayers.length === 0) return null

  const scored = availablePlayers.map(player => ({
    player,
    score: scoreRookiePlayer(player, teamRoster, teamDirection, pickNumber, round),
  }))

  scored.sort((a, b) => b.score - a.score)

  // Weighted random among top 3 (65/25/10%)
  const weights = [0.65, 0.25, 0.10]
  const candidates = scored.slice(0, Math.min(3, scored.length))
  const roll = Math.random()

  let cumulative = 0
  for (let i = 0; i < candidates.length; i++) {
    cumulative += weights[i] || 0
    if (roll < cumulative) {
      return candidates[i].player
    }
  }

  return candidates[0].player
}
