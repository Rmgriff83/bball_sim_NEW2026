import { SeasonManager } from './SeasonManager'

// ---------------------------------------------------------------------------
// AllStarService
// ---------------------------------------------------------------------------
// Handles All-Star and Rising Stars team selection based on player statistics,
// team performance, and eligibility rules. All data is passed in and returned
// as plain objects — no file I/O or database access.
// ---------------------------------------------------------------------------

const ALL_STAR_MONTH = 1  // January
const ALL_STAR_DAY = 13
const ALL_STAR_MIN_GAMES_PCT = 0.60
const RISING_STARS_MIN_GAMES_PCT = 0.40

export class AllStarService {

  // -----------------------------------------------------------------------
  // Main Entry Point
  // -----------------------------------------------------------------------

  /**
   * Process All-Star and Rising Stars selections if date conditions are met.
   *
   * @param {Object} params
   * @param {Object} params.seasonData - Current season data
   * @param {number} params.year - Season year
   * @param {string} params.currentDate - Current campaign date (YYYY-MM-DD)
   * @param {Array} params.allPlayers - Unified array of all players with:
   *   { id, firstName/first_name, lastName/last_name, position, secondaryPosition/secondary_position,
   *     draftYear/draft_year, teamId/team_id, teamAbbreviation, overallRating/overall_rating,
   *     allStarSelections/all_star_selections }
   * @param {Array} params.teams - All team objects [{ id, abbreviation, conference, primary_color, ... }]
   * @param {number|string} params.userTeamId - The user's team ID
   * @param {boolean} [params.alreadySelected=false] - Whether All-Star was already processed this season
   * @returns {Object|null} { allStars, risingStars, newsEvents } or null if not triggered
   */
  static processAllStarSelections({
    seasonData,
    year,
    currentDate,
    allPlayers,
    teams,
    userTeamId,
    alreadySelected = false,
  }) {
    // Already processed this season
    if (alreadySelected) return null

    // Check if current date >= Jan 13 of season+1 year
    const triggerDate = `${year + 1}-${String(ALL_STAR_MONTH).padStart(2, '0')}-${String(ALL_STAR_DAY).padStart(2, '0')}`
    if (currentDate < triggerDate) return null

    // Gather data
    const allStats = SeasonManager.getAllPlayerStats(seasonData)
    const standings = SeasonManager.getStandings(seasonData)

    // Build team win percentages from standings
    const teamWinPcts = AllStarService._buildTeamWinPcts(standings)

    // Build unified player lookup
    const playerLookup = AllStarService._buildPlayerLookup(allPlayers, teams)

    // Select All-Stars
    const allStars = AllStarService._selectTeam(allStats, playerLookup, teamWinPcts, false, year)

    // Select Rising Stars
    const risingStars = AllStarService._selectTeam(allStats, playerLookup, teamWinPcts, true, year)

    // Generate news events
    const newsEvents = AllStarService._generateNewsEvents(allStars, risingStars, playerLookup, userTeamId, currentDate)

    // Collect selected player IDs for award tracking
    const allStarIds = AllStarService._collectSelectedPlayerIds(allStars)
    const risingStarIds = AllStarService._collectSelectedPlayerIds(risingStars)
    const allSelectedIds = [...new Set([...allStarIds, ...risingStarIds])]

    // Store rosters on season data
    const rosters = { allStars, risingStars }
    seasonData.allStarRosters = rosters
    seasonData.metadata.updatedAt = new Date().toISOString()

    return {
      allStars,
      risingStars,
      rosters,
      newsEvents,
      selectedPlayerIds: allSelectedIds,
      allStarPlayerIds: allStarIds,
      risingStarPlayerIds: risingStarIds,
    }
  }

  // -----------------------------------------------------------------------
  // Team Win Percentages
  // -----------------------------------------------------------------------

  /**
   * Build team win percentages from standings data.
   * @private
   */
  static _buildTeamWinPcts(standings) {
    const winPcts = {}
    for (const conf of ['east', 'west']) {
      for (const standing of (standings[conf] ?? [])) {
        const teamId = standing.teamId ?? null
        if (!teamId) continue
        const wins = standing.wins ?? 0
        const losses = standing.losses ?? 0
        const total = wins + losses
        winPcts[teamId] = total > 0 ? wins / total : 0
      }
    }
    return winPcts
  }

  // -----------------------------------------------------------------------
  // Player Lookup
  // -----------------------------------------------------------------------

  /**
   * Build a unified player lookup from all players.
   * @private
   * @param {Array} allPlayers
   * @param {Array} teams
   * @returns {Object} Keyed by playerId string
   */
  static _buildPlayerLookup(allPlayers, teams) {
    const lookup = {}

    // Build team lookup by id and abbreviation
    const teamsById = {}
    const teamsByAbbr = {}
    for (const t of teams) {
      teamsById[t.id] = t
      teamsByAbbr[t.abbreviation] = t
    }

    for (const player of allPlayers) {
      const playerId = String(player.id ?? '')
      if (!playerId) continue

      const teamAbbr = player.teamAbbreviation ?? player.team_abbreviation ?? null
      const teamId = player.teamId ?? player.team_id ?? null

      // Skip free agents
      if (teamAbbr === 'FA') continue

      // Find team
      let team = null
      if (teamId) team = teamsById[teamId]
      if (!team && teamAbbr) team = teamsByAbbr[teamAbbr]
      if (!team) continue

      const firstName = player.firstName ?? player.first_name ?? ''
      const lastName = player.lastName ?? player.last_name ?? ''

      lookup[playerId] = {
        playerId,
        playerName: `${firstName} ${lastName}`.trim(),
        position: player.position ?? 'SG',
        secondaryPosition: player.secondaryPosition ?? player.secondary_position ?? null,
        draftYear: player.draftYear ?? player.draft_year ?? null,
        teamId: team.id,
        teamAbbr: team.abbreviation,
        teamColor: team.primary_color ?? team.primaryColor ?? '#6B7280',
        conference: team.conference ?? 'east',
        overallRating: player.overallRating ?? player.overall_rating ?? 70,
      }
    }

    return lookup
  }

  // -----------------------------------------------------------------------
  // Team Selection
  // -----------------------------------------------------------------------

  /**
   * Select All-Star or Rising Stars teams for both conferences.
   * @private
   */
  static _selectTeam(allStats, playerLookup, teamWinPcts, risingStarsOnly, seasonYear) {
    // Find max games played to compute threshold
    let maxGames = 0
    for (const stats of Object.values(allStats)) {
      const gp = stats.gamesPlayed ?? 0
      if (gp > maxGames) maxGames = gp
    }

    const minGamesPct = risingStarsOnly ? RISING_STARS_MIN_GAMES_PCT : ALL_STAR_MIN_GAMES_PCT
    const minGames = Math.ceil(maxGames * minGamesPct)

    // Score eligible players
    const scoredPlayers = {}
    for (const [playerId, stats] of Object.entries(allStats)) {
      const pid = String(playerId)
      const gp = stats.gamesPlayed ?? 0

      // Min games filter
      if (gp < minGames) continue

      // Must exist in player lookup
      const playerInfo = playerLookup[pid]
      if (!playerInfo) continue

      // Rising Stars filter: rookies and 2nd-year players
      if (risingStarsOnly) {
        const draftYear = playerInfo.draftYear
        if (draftYear == null || draftYear < seasonYear - 1) continue
      }

      const teamWinPct = teamWinPcts[playerInfo.teamId] ?? 0
      const score = AllStarService._scorePlayer(stats, teamWinPct)

      scoredPlayers[pid] = {
        playerId: pid,
        playerName: playerInfo.playerName,
        teamId: playerInfo.teamId,
        teamAbbr: playerInfo.teamAbbr,
        teamColor: playerInfo.teamColor,
        position: playerInfo.position,
        secondaryPosition: playerInfo.secondaryPosition,
        conference: playerInfo.conference,
        stats: {
          gp,
          ppg: Math.round(((stats.points ?? 0) / gp) * 10) / 10,
          rpg: Math.round(((stats.rebounds ?? 0) / gp) * 10) / 10,
          apg: Math.round(((stats.assists ?? 0) / gp) * 10) / 10,
          spg: Math.round(((stats.steals ?? 0) / gp) * 10) / 10,
          bpg: Math.round(((stats.blocks ?? 0) / gp) * 10) / 10,
          fgPct: (stats.fieldGoalsAttempted ?? 0) > 0
            ? Math.round(((stats.fieldGoalsMade ?? 0) / stats.fieldGoalsAttempted * 100) * 10) / 10
            : 0,
          threePct: (stats.threePointersAttempted ?? 0) > 0
            ? Math.round(((stats.threePointersMade ?? 0) / stats.threePointersAttempted * 100) * 10) / 10
            : 0,
        },
        score: Math.round(score * 10) / 10,
      }
    }

    // Split by conference
    const eastPlayers = {}
    const westPlayers = {}
    for (const [id, p] of Object.entries(scoredPlayers)) {
      if (p.conference === 'east') {
        eastPlayers[id] = p
      } else {
        westPlayers[id] = p
      }
    }

    return {
      east: AllStarService._selectConference(eastPlayers, risingStarsOnly),
      west: AllStarService._selectConference(westPlayers, risingStarsOnly),
    }
  }

  /**
   * Score a player for All-Star consideration.
   * @private
   */
  static _scorePlayer(stats, teamWinPct) {
    let gp = stats.gamesPlayed ?? 1
    if (gp === 0) gp = 1

    const ppg = (stats.points ?? 0) / gp
    const rpg = (stats.rebounds ?? 0) / gp
    const apg = (stats.assists ?? 0) / gp
    const spg = (stats.steals ?? 0) / gp
    const bpg = (stats.blocks ?? 0) / gp
    const tovpg = (stats.turnovers ?? 0) / gp

    const statScore = (ppg * 3) + (rpg * 2) + (apg * 2.5) + (spg * 2) + (bpg * 1.5) - (tovpg * 1)
    const teamBonus = teamWinPct * 10

    return statScore + teamBonus
  }

  /**
   * Select starters and reserves for one conference.
   * @private
   */
  static _selectConference(conferencePlayers, risingStarsOnly = false) {
    const positions = ['PG', 'SG', 'SF', 'PF', 'C']
    const starters = {}

    // Sort pool by score descending for starter selection
    const pool = { ...conferencePlayers }
    const sortedIds = Object.keys(pool).sort((a, b) => pool[b].score - pool[a].score)

    // Use sorted order for selection
    const orderedPool = {}
    for (const id of sortedIds) {
      orderedPool[id] = pool[id]
    }

    // Select one starter per position
    for (const pos of positions) {
      let bestForPos = null
      let bestId = null

      for (const [id, player] of Object.entries(orderedPool)) {
        if (player.position === pos || player.secondaryPosition === pos) {
          if (!bestForPos || player.score > bestForPos.score) {
            bestForPos = player
            bestId = id
          }
        }
      }

      if (bestForPos) {
        bestForPos.starterPosition = pos
        starters[pos] = bestForPos
        delete orderedPool[bestId]
      }
    }

    // Sort remaining by score, take top 7 as reserves
    const remainingIds = Object.keys(orderedPool).sort((a, b) => orderedPool[b].score - orderedPool[a].score)
    const maxReserves = risingStarsOnly ? Math.min(7, remainingIds.length) : 7
    const reserves = remainingIds.slice(0, maxReserves).map(id => orderedPool[id])

    return {
      starters,
      reserves,
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Collect all player IDs from a selection result.
   * @private
   */
  static _collectSelectedPlayerIds(selection) {
    const ids = []
    for (const conf of ['east', 'west']) {
      for (const player of Object.values(selection[conf]?.starters ?? {})) {
        ids.push(String(player.playerId))
      }
      for (const player of (selection[conf]?.reserves ?? [])) {
        ids.push(String(player.playerId))
      }
    }
    return ids
  }

  // -----------------------------------------------------------------------
  // News Generation
  // -----------------------------------------------------------------------

  /**
   * Generate news event objects for All-Star announcements.
   * Returns an array of plain news event objects (not persisted).
   * @private
   * @returns {Array} Array of { eventType, headline, body, playerId?, teamId?, gameDate }
   */
  static _generateNewsEvents(allStars, risingStars, playerLookup, userTeamId, currentDate) {
    const events = []

    // Build body with starter names
    const bodyParts = []
    const confNames = { east: 'Eastern', west: 'Western' }

    for (const [conf, confName] of Object.entries(confNames)) {
      const starters = allStars[conf]?.starters ?? {}
      const names = Object.values(starters).map(p => p.playerName)
      if (names.length > 0) {
        bodyParts.push(`${confName} Conference starters: ${names.join(', ')}`)
      }
    }

    const body = bodyParts.join('. ') + '.'

    // Main announcement
    events.push({
      eventType: 'award',
      headline: 'All-Star & Rising Stars teams announced',
      body,
      gameDate: currentDate,
    })

    // Individual news for user team players selected
    const allStarIds = AllStarService._collectSelectedPlayerIds(allStars)
    const risingStarIds = AllStarService._collectSelectedPlayerIds(risingStars)
    const allSelectedIds = [...new Set([...allStarIds, ...risingStarIds])]

    for (const playerId of allSelectedIds) {
      const playerInfo = playerLookup[playerId]
      if (!playerInfo || playerInfo.teamId != userTeamId) continue

      const inAllStar = allStarIds.includes(playerId)
      const inRising = risingStarIds.includes(playerId)

      let label
      if (inAllStar && inRising) {
        label = 'All-Star & Rising Stars'
      } else if (inAllStar) {
        label = 'All-Star'
      } else {
        label = 'Rising Stars'
      }

      events.push({
        eventType: 'award',
        headline: `${playerInfo.playerName} selected to ${label} team`,
        body: `Your player ${playerInfo.playerName} has been named to the ${label} team this season.`,
        playerId,
        teamId: userTeamId,
        gameDate: currentDate,
      })
    }

    return events
  }
}

export default AllStarService
