import { TEAMS } from '../data/teams'

// ---------------------------------------------------------------------------
// SeasonManager
// ---------------------------------------------------------------------------
// Manages season data in-memory: schedule generation, standings updates,
// player/team stats tracking, and season queries. All data is passed in and
// returned as plain objects — no file I/O or database access.
// ---------------------------------------------------------------------------

export class SeasonManager {

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Create a fresh season data structure.
   * @param {Array} teams - Array of team objects with { id, abbreviation, conference, ... }
   * @param {number} year - Season year
   * @param {number|string} campaignId
   * @returns {Object} Initialized season data
   */
  static initializeSeason(teams, year, campaignId) {
    const standings = SeasonManager.generateInitialStandings(teams)
    const teamStats = SeasonManager.generateInitialTeamStats(teams)

    return {
      metadata: {
        campaignId,
        year,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      standings,
      schedule: [],
      playerStats: {},
      playoffPlayerStats: {},
      teamStats,
      playoffBracket: null,
      news: [],
    }
  }

  /**
   * Generate initial standings with all teams at 0-0.
   * @param {Array} teams
   * @returns {{ east: Array, west: Array }}
   */
  static generateInitialStandings(teams) {
    const east = []
    const west = []

    for (const team of teams) {
      const teamStanding = {
        teamId: team.id,
        teamAbbreviation: team.abbreviation,
        wins: 0,
        losses: 0,
        streak: null,
        last10: '0-0',
        homeRecord: '0-0',
        awayRecord: '0-0',
        conferenceRecord: '0-0',
        divisionRecord: '0-0',
        pointsFor: 0,
        pointsAgainst: 0,
      }

      if (team.conference === 'east') {
        east.push(teamStanding)
      } else {
        west.push(teamStanding)
      }
    }

    return { east, west }
  }

  /**
   * Generate initial team stats.
   * @param {Array} teams
   * @returns {Object} Keyed by teamId
   */
  static generateInitialTeamStats(teams) {
    const stats = {}

    for (const team of teams) {
      stats[team.id] = {
        teamId: team.id,
        teamAbbreviation: team.abbreviation,
        wins: 0,
        losses: 0,
        homeWins: 0,
        homeLosses: 0,
        pointsScored: 0,
        pointsAllowed: 0,
        playoffSeed: null,
        playoffResult: null,
      }
    }

    return stats
  }

  // -----------------------------------------------------------------------
  // Schedule Generation
  // -----------------------------------------------------------------------

  /**
   * Generate the regular season schedule.
   * @param {Object} seasonData - Current season data (will be mutated)
   * @param {Array} teams - All teams [{ id, abbreviation, conference, ... }]
   * @param {number|string} userTeamId - The user's team ID
   * @param {number} year - Season year
   * @param {string} [startDateStr='2025-10-21'] - Season start date (YYYY-MM-DD)
   * @returns {number} Number of games created
   */
  static generateSchedule(seasonData, teams, userTeamId, year, startDateStr = '2025-10-21') {
    const teamIds = teams.map(t => t.id)
    const teamConferences = {}
    const teamAbbreviations = {}
    for (const t of teams) {
      teamConferences[t.id] = t.conference
      teamAbbreviations[t.id] = t.abbreviation
    }

    // Build matchups for an 82-game NBA-style season:
    //   • 30 non-conference games per team (2 vs each of 15 opponents)
    //   • 52 same-conference games per team (mix of 3- and 4-game series)
    // Total per team = 82. Total league games = 30 × 82 / 2 = 1230.
    const targetGamesPerTeam = 82
    const NON_CONF_GAMES_PER_PAIR = 2
    const CONF_GAMES_PER_TEAM = 52
    const matchups = []

    // Group teams by conference
    const conferenceGroups = {}
    for (const id of teamIds) {
      const conf = teamConferences[id]
      if (!conferenceGroups[conf]) conferenceGroups[conf] = []
      conferenceGroups[conf].push(id)
    }

    // ─── Phase 1: Non-conference matchups ──────────────────────────────
    // Every cross-conference pair plays exactly NON_CONF_GAMES_PER_PAIR
    // times. We alternate home/away across the two games so each team
    // hosts the other once (a "home-and-home"). With 2 games per pair
    // and 15×15 = 225 pairs, that's 450 games — 30 per team.
    for (let i = 0; i < teamIds.length; i++) {
      for (let j = i + 1; j < teamIds.length; j++) {
        if (teamConferences[teamIds[i]] === teamConferences[teamIds[j]]) continue
        // First game: random home/away. Subsequent games swap.
        let homeFirst = Math.random() < 0.5
        for (let g = 0; g < NON_CONF_GAMES_PER_PAIR; g++) {
          const home = homeFirst ? teamIds[i] : teamIds[j]
          const away = homeFirst ? teamIds[j] : teamIds[i]
          matchups.push({ homeTeamId: home, awayTeamId: away })
          homeFirst = !homeFirst
        }
      }
    }

    // ─── Phase 2: Same-conference matchups ─────────────────────────────
    // Each team plays 14 same-conference opponents. We need 52 games per
    // team within conference. NBA-style split: 10 opponents @ 4 games
    // (40) + 4 opponents @ 3 games (12) = 52. Selection of which
    // opponents are "3-game" vs "4-game" is randomized but kept
    // reciprocally consistent (if A plays B 3 times, B plays A 3 times).
    const teamGameCounts = {}
    for (const id of teamIds) teamGameCounts[id] = 0
    // Initial counts include the non-conference games already pushed.
    for (const m of matchups) {
      teamGameCounts[m.homeTeamId]++
      teamGameCounts[m.awayTeamId]++
    }

    for (const confTeams of Object.values(conferenceGroups)) {
      // Each team needs CONF_GAMES_PER_TEAM games across its same-conf
      // opponents. NBA-style split: 10 opponents × 4 games (40) + 4 opponents
      // × 3 games (12) = 52 per team.
      const opponentsPerTeam = confTeams.length - 1 // 14
      // Solve: 4·F + 3·T = 52, F + T = 14 → F = 10, T = 4.
      const fourGameOpponents = CONF_GAMES_PER_TEAM - 3 * opponentsPerTeam // 10
      const threeGameOpponents = opponentsPerTeam - fourGameOpponents      // 4

      // Circulant-graph construction guarantees each team gets exactly
      // threeGameOpponents (= 4) three-game opponents — equivalent to picking
      // a 4-regular subgraph of K_n. For each i in 0..n, draw an edge to
      // (i + d) mod n for each chosen distance d ∈ {1..⌊n/2⌋}. Two distances
      // produce a 4-regular graph (each vertex picks up degree 2 per distance).
      const threePairs = selectThreeGamePairs(confTeams, threeGameOpponents)

      const seriesLength = new Map() // pairKey → 3 or 4
      const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)
      // All conference pairs default to 4 games
      for (let i = 0; i < confTeams.length; i++) {
        for (let j = i + 1; j < confTeams.length; j++) {
          seriesLength.set(pairKey(confTeams[i], confTeams[j]), 4)
        }
      }
      // Override the 3-game pairs
      for (const [a, b] of threePairs) {
        seriesLength.set(pairKey(a, b), 3)
      }

      // Emit games. For each pair, alternate home/away across the
      // series so series feel like real NBA home-and-homes.
      const pairs = []
      for (let i = 0; i < confTeams.length; i++) {
        for (let j = i + 1; j < confTeams.length; j++) {
          pairs.push([confTeams[i], confTeams[j]])
        }
      }
      for (const [a, b] of pairs) {
        const games = seriesLength.get(pairKey(a, b)) || 4
        let homeFirst = Math.random() < 0.5
        for (let g = 0; g < games; g++) {
          const home = homeFirst ? a : b
          const away = homeFirst ? b : a
          matchups.push({ homeTeamId: home, awayTeamId: away })
          teamGameCounts[home]++
          teamGameCounts[away]++
          homeFirst = !homeFirst
        }
      }
    }

    // Distribute games across season ensuring no team plays twice on the same day
    shuffleArray(matchups)
    const gamesPerDay = 10
    // League-wide pacing:
    //   MIN gap = 2 calendar days → at least one day off between ANY team's
    //   games (no back-to-backs, which were spiking fatigue too hard).
    //   MAX gap = 3 calendar days → forces a USER game by day 3 so the user
    //   never has to sim through a long stretch of AI-only days. AI teams
    //   don't get an explicit "must play" force; the per-day sort below
    //   prioritizes whichever team has rested longest, which keeps every
    //   AI team's cadence naturally tight without an extra priority pass.
    // The season expands later into the calendar as a result; calendar-date
    // triggers (trade deadline / All-Star) still fire at their fixed dates
    // and are unaffected by this pacing.
    const TEAM_MIN_GAP_DAYS = 2
    const USER_GAME_MAX_GAP_DAYS = 3
    let currentDate = parseDate(startDateStr)
    const schedule = []
    let gameNumber = 1
    let remaining = [...matchups]
    const teamLastGameDate = new Map() // teamId → Date of most recent scheduled game

    const daysSinceLastGame = (teamId) => {
      const last = teamLastGameDate.get(teamId)
      if (!last) return Infinity
      return daysBetween(last, currentDate)
    }
    const teamCanPlayToday = (teamId) => daysSinceLastGame(teamId) >= TEAM_MIN_GAP_DAYS

    while (remaining.length > 0) {
      const dayGames = []
      const teamsPlayingToday = []
      let unscheduled = []
      const dateStr = formatDate(currentDate)

      // Pacing for the user's slot today.
      //   userMustPlayToday: at/over the max gap → force a user matchup
      //   first, before AI games fill the day.
      let userMustPlayToday = false
      if (teamLastGameDate.has(userTeamId)) {
        userMustPlayToday = daysSinceLastGame(userTeamId) >= USER_GAME_MAX_GAP_DAYS
      } else {
        // User hasn't played yet — schedule ASAP
        userMustPlayToday = true
      }

      // If user must play today, try to schedule one first
      if (userMustPlayToday) {
        let userScheduled = false
        const stillRemaining = []
        for (const matchup of remaining) {
          if (userScheduled) {
            stillRemaining.push(matchup)
            continue
          }
          const home = matchup.homeTeamId
          const away = matchup.awayTeamId
          if (home === userTeamId || away === userTeamId) {
            dayGames.push(matchup)
            teamsPlayingToday.push(home, away)
            userScheduled = true
            teamLastGameDate.set(home, new Date(currentDate))
            teamLastGameDate.set(away, new Date(currentDate))
          } else {
            stillRemaining.push(matchup)
          }
        }
        remaining = stillRemaining
      }

      // Prioritize matchups whose teams have been resting longest. Without
      // this, the random shuffle can leave a few teams paired with always-busy
      // opponents and their remaining matchups pile up at the season's tail.
      remaining.sort((a, b) => {
        const aMax = Math.max(daysSinceLastGame(a.homeTeamId), daysSinceLastGame(a.awayTeamId))
        const bMax = Math.max(daysSinceLastGame(b.homeTeamId), daysSinceLastGame(b.awayTeamId))
        return bMax - aMax
      })

      // Fill remaining slots for the day
      for (const matchup of remaining) {
        const home = matchup.homeTeamId
        const away = matchup.awayTeamId

        // Per-team rest enforcement — either team still inside the min-gap
        // window bumps the matchup to a later day.
        if (!teamCanPlayToday(home) || !teamCanPlayToday(away)) {
          unscheduled.push(matchup)
          continue
        }

        if (dayGames.length >= gamesPerDay ||
            teamsPlayingToday.includes(home) ||
            teamsPlayingToday.includes(away)) {
          unscheduled.push(matchup)
          continue
        }

        dayGames.push(matchup)
        teamsPlayingToday.push(home, away)
        teamLastGameDate.set(home, new Date(currentDate))
        teamLastGameDate.set(away, new Date(currentDate))
      }

      for (const matchup of dayGames) {
        const gameId = `game_${year}_${String(gameNumber).padStart(4, '0')}`

        schedule.push({
          id: gameId,
          homeTeamId: matchup.homeTeamId,
          homeTeamAbbreviation: teamAbbreviations[matchup.homeTeamId],
          awayTeamId: matchup.awayTeamId,
          awayTeamAbbreviation: teamAbbreviations[matchup.awayTeamId],
          gameDate: dateStr,
          isPlayoff: false,
          playoffRound: null,
          playoffGameNumber: null,
          isComplete: false,
          homeScore: null,
          awayScore: null,
          boxScore: null,
        })

        gameNumber++
      }

      // Re-shuffle remaining to avoid ordering bias
      shuffleArray(unscheduled)
      remaining = unscheduled

      currentDate = addDays(currentDate, 1)
    }

    seasonData.schedule = schedule
    seasonData.metadata.updatedAt = new Date().toISOString()

    return schedule.length
  }

  // -----------------------------------------------------------------------
  // Schedule Queries
  // -----------------------------------------------------------------------

  /**
   * Get full schedule from season data.
   */
  static getSchedule(seasonData) {
    return seasonData?.schedule ?? []
  }

  /**
   * Get games for a specific date.
   */
  static getGamesByDate(seasonData, date) {
    const schedule = SeasonManager.getSchedule(seasonData)
    return schedule.filter(game => game.gameDate === date)
  }

  /**
   * Get upcoming (incomplete) games for a team.
   */
  static getUpcomingGames(seasonData, teamId, limit = 5, fromDate = null) {
    const schedule = SeasonManager.getSchedule(seasonData)

    const teamGames = schedule.filter(game => {
      if (game.isComplete) return false
      if (game.homeTeamId !== teamId && game.awayTeamId !== teamId) return false
      if (fromDate && game.gameDate < fromDate) return false
      return true
    })

    teamGames.sort((a, b) => a.gameDate.localeCompare(b.gameDate))
    return teamGames.slice(0, limit)
  }

  /**
   * Get completed games.
   */
  static getCompletedGames(seasonData) {
    const schedule = SeasonManager.getSchedule(seasonData)
    return schedule.filter(game => game.isComplete)
  }

  /**
   * Get a specific game by ID.
   */
  static getGame(seasonData, gameId) {
    const schedule = SeasonManager.getSchedule(seasonData)
    return schedule.find(game => game.id === gameId) ?? null
  }

  /**
   * Get the next incomplete game for a specific team.
   */
  static getNextTeamGame(seasonData, teamId, fromDate = null) {
    const games = SeasonManager.getUpcomingGames(seasonData, teamId, 1, fromDate)
    return games[0] ?? null
  }

  // -----------------------------------------------------------------------
  // Game Updates
  // -----------------------------------------------------------------------

  /**
   * Update a game with results.
   * @param {Object} seasonData - Mutated in place
   * @param {string} gameId
   * @param {Object} data - Game result data to merge
   * @param {boolean} [isUserGame=true] - If false, compacts the box score
   * @returns {boolean}
   */
  static updateGame(seasonData, gameId, data, isUserGame = true) {
    if (!seasonData) return false

    const index = seasonData.schedule.findIndex(g => g.id === gameId)
    if (index === -1) return false

    // For AI vs AI games, strip detailed box score to save storage
    if (!isUserGame && data.boxScore) {
      data.boxScore = SeasonManager.compactBoxScore(data.boxScore)
    }

    seasonData.schedule[index] = { ...seasonData.schedule[index], ...data }
    seasonData.metadata.updatedAt = new Date().toISOString()

    return true
  }

  /**
   * Compact box score for AI games - keeps only essential data.
   */
  static compactBoxScore(boxScore) {
    const compact = {}

    for (const team of ['home', 'away']) {
      compact[team] = []
      for (const player of (boxScore[team] ?? [])) {
        compact[team].push({
          player_id: player.player_id ?? player.playerId ?? null,
          name: player.name ?? 'Unknown',
          points: player.points ?? 0,
          rebounds: player.rebounds ?? 0,
          assists: player.assists ?? 0,
          minutes: player.minutes ?? 0,
        })
      }
    }

    return compact
  }

  // -----------------------------------------------------------------------
  // Standings
  // -----------------------------------------------------------------------

  /**
   * Get standings.
   */
  static getStandings(seasonData) {
    return seasonData?.standings ?? { east: [], west: [] }
  }

  /**
   * Update standings after a game.
   * Mutates seasonData in place.
   */
  static updateStandingsAfterGame(
    seasonData,
    homeTeamId,
    awayTeamId,
    homeScore,
    awayScore
  ) {
    if (!seasonData) return

    const homeWon = homeScore > awayScore

    for (const conf of ['east', 'west']) {
      for (let i = 0; i < seasonData.standings[conf].length; i++) {
        let standing = seasonData.standings[conf][i]
        if (standing.teamId === homeTeamId) {
          seasonData.standings[conf][i] = SeasonManager._updateTeamStanding(standing, homeWon, homeScore, awayScore, true)
        }
        if (standing.teamId === awayTeamId) {
          seasonData.standings[conf][i] = SeasonManager._updateTeamStanding(standing, !homeWon, awayScore, homeScore, false)
        }
      }

      // Sort by win percentage descending, then point differential as tiebreaker
      seasonData.standings[conf].sort((a, b) => {
        const totalA = a.wins + a.losses
        const totalB = b.wins + b.losses
        const pctA = totalA > 0 ? a.wins / totalA : 0
        const pctB = totalB > 0 ? b.wins / totalB : 0
        if (pctA !== pctB) return pctB - pctA
        const diffA = (a.pointsFor ?? 0) - (a.pointsAgainst ?? 0)
        const diffB = (b.pointsFor ?? 0) - (b.pointsAgainst ?? 0)
        return diffB - diffA
      })
    }

    // Update team stats
    SeasonManager._updateTeamStatsAfterGame(seasonData, homeTeamId, homeScore, awayScore, true)
    SeasonManager._updateTeamStatsAfterGame(seasonData, awayTeamId, awayScore, homeScore, false)

    seasonData.metadata.updatedAt = new Date().toISOString()
  }

  /**
   * Update a single team's standing entry.
   * @private
   */
  static _updateTeamStanding(standing, won, pointsFor, pointsAgainst, isHome) {
    const updated = { ...standing }

    if (won) {
      updated.wins++
      updated.streak = SeasonManager._updateStreak(updated.streak, true)
    } else {
      updated.losses++
      updated.streak = SeasonManager._updateStreak(updated.streak, false)
    }

    if (isHome) {
      updated.homeRecord = SeasonManager._updateRecord(updated.homeRecord, won)
    } else {
      updated.awayRecord = SeasonManager._updateRecord(updated.awayRecord, won)
    }

    updated.pointsFor += pointsFor
    updated.pointsAgainst += pointsAgainst

    return updated
  }

  /**
   * Update streak string (e.g. "W3", "L1").
   * @private
   */
  static _updateStreak(streak, won) {
    if (!streak) {
      return won ? 'W1' : 'L1'
    }

    const type = streak.charAt(0)
    const count = parseInt(streak.substring(1), 10)

    if ((type === 'W' && won) || (type === 'L' && !won)) {
      return type + (count + 1)
    }

    return won ? 'W1' : 'L1'
  }

  /**
   * Update record string (e.g. "15-3").
   * @private
   */
  static _updateRecord(record, won) {
    const parts = record.split('-')
    let wins = parseInt(parts[0] ?? '0', 10)
    let losses = parseInt(parts[1] ?? '0', 10)

    if (won) {
      wins++
    } else {
      losses++
    }

    return `${wins}-${losses}`
  }

  /**
   * Update team stats after a game.
   * @private
   */
  static _updateTeamStatsAfterGame(seasonData, teamId, pointsFor, pointsAgainst, isHome) {
    const stats = seasonData.teamStats?.[teamId]
    if (!stats) return

    const won = pointsFor > pointsAgainst

    if (won) {
      stats.wins++
      if (isHome) stats.homeWins++
    } else {
      stats.losses++
      if (isHome) stats.homeLosses++
    }

    stats.pointsScored += pointsFor
    stats.pointsAllowed += pointsAgainst
  }

  // -----------------------------------------------------------------------
  // Player Stats
  // -----------------------------------------------------------------------

  /**
   * Select the regular-season or playoff stats bucket on seasonData. Lazy-
   * initializes `playoffPlayerStats` on legacy seasonData that pre-dates the
   * split — `playerStats` itself is created by initializeSeason so it's always
   * there.
   */
  static _getStatsBucket(seasonData, isPlayoff) {
    if (isPlayoff) {
      if (!seasonData.playoffPlayerStats) seasonData.playoffPlayerStats = {}
      return seasonData.playoffPlayerStats
    }
    return seasonData.playerStats
  }

  /**
   * Update player stats after a game.
   * Mutates seasonData in place. Playoff games are written to a separate
   * `playoffPlayerStats` bucket so award eligibility (which gates on a % of
   * max regular-season games) isn't distorted by deep-playoff teams piling
   * up extra games.
   */
  static updatePlayerStats(seasonData, playerId, playerName, teamId, gameStats, { isPlayoff = false } = {}) {
    if (!seasonData) return

    const pid = String(playerId)
    const bucket = SeasonManager._getStatsBucket(seasonData, isPlayoff)

    if (!bucket[pid]) {
      bucket[pid] = SeasonManager._createEmptyPlayerStats(pid, playerName, teamId)
    }

    const stats = bucket[pid]
    const minutesPlayed = gameStats.minutes ?? 0

    // Chronological record of every team the player has LOGGED GAMES for this
    // season (a mid-season trade adds a second entry the first time he suits
    // up for the new team). Lazily initialized so pre-existing buckets from
    // live campaigns keep working. Powers the multi-team "POR/DET" season label.
    if (!Array.isArray(stats.teams)) {
      stats.teams = stats.teamId != null ? [stats.teamId] : []
    }
    if (teamId != null && stats.teams[stats.teams.length - 1] !== teamId) {
      stats.teams.push(teamId)
    }

    // Only count as a game played if the player actually got minutes
    if (minutesPlayed > 0) {
      stats.gamesPlayed++
    }
    stats.minutesPlayed += minutesPlayed
    stats.points += gameStats.points ?? 0
    stats.rebounds += gameStats.rebounds ?? 0
    stats.offensiveRebounds += gameStats.offensiveRebounds ?? gameStats.offensive_rebounds ?? 0
    stats.defensiveRebounds += gameStats.defensiveRebounds ?? gameStats.defensive_rebounds ?? 0
    stats.assists += gameStats.assists ?? 0
    stats.steals += gameStats.steals ?? 0
    stats.blocks += gameStats.blocks ?? 0
    stats.turnovers += gameStats.turnovers ?? 0
    stats.personalFouls += gameStats.fouls ?? gameStats.personalFouls ?? 0
    stats.fieldGoalsMade += gameStats.fieldGoalsMade ?? gameStats.fgm ?? 0
    stats.fieldGoalsAttempted += gameStats.fieldGoalsAttempted ?? gameStats.fga ?? 0
    stats.threePointersMade += gameStats.threePointersMade ?? gameStats.fg3m ?? 0
    stats.threePointersAttempted += gameStats.threePointersAttempted ?? gameStats.fg3a ?? 0
    stats.freeThrowsMade += gameStats.freeThrowsMade ?? gameStats.ftm ?? 0
    stats.freeThrowsAttempted += gameStats.freeThrowsAttempted ?? gameStats.fta ?? 0
  }

  /**
   * Create an empty player stats record.
   * @private
   */
  static _createEmptyPlayerStats(playerId, playerName, teamId) {
    return {
      playerId,
      playerName,
      teamId,
      // Ordered list of teams the player records stats for this season
      // (scalar teamId kept for backward compatibility with existing readers).
      teams: teamId != null ? [teamId] : [],
      gamesPlayed: 0,
      gamesStarted: 0,
      minutesPlayed: 0,
      points: 0,
      rebounds: 0,
      offensiveRebounds: 0,
      defensiveRebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      personalFouls: 0,
      fieldGoalsMade: 0,
      fieldGoalsAttempted: 0,
      threePointersMade: 0,
      threePointersAttempted: 0,
      freeThrowsMade: 0,
      freeThrowsAttempted: 0,
    }
  }

  /**
   * Get a single player's stats. Defaults to regular-season; pass
   * `{ isPlayoff: true }` to read the playoff bucket.
   */
  static getPlayerStats(seasonData, playerId, { isPlayoff = false } = {}) {
    const bucket = isPlayoff ? seasonData?.playoffPlayerStats : seasonData?.playerStats
    return bucket?.[String(playerId)] ?? null
  }

  /**
   * Get all player stats for a season. Defaults to regular-season; pass
   * `{ isPlayoff: true }` to read the playoff bucket.
   */
  static getAllPlayerStats(seasonData, { isPlayoff = false } = {}) {
    return (isPlayoff ? seasonData?.playoffPlayerStats : seasonData?.playerStats) ?? {}
  }

  /**
   * Migrate player stats from one player ID to another (used during trades).
   * Migrates both the regular-season and playoff buckets so a mid-playoff
   * trade doesn't drop the new player's playoff record.
   */
  static migratePlayerStats(seasonData, oldPlayerId, newPlayerId, newTeamId, newPlayerName) {
    if (!seasonData) return false

    const oldKey = String(oldPlayerId)
    const newKey = String(newPlayerId)
    let migrated = false

    for (const bucketKey of ['playerStats', 'playoffPlayerStats']) {
      const bucket = seasonData[bucketKey]
      if (!bucket) continue
      const oldStats = bucket[oldKey]
      if (!oldStats) continue

      bucket[newKey] = {
        ...oldStats,
        playerId: newKey,
        playerName: newPlayerName,
        teamId: newTeamId,
      }
      delete bucket[oldKey]
      migrated = true
    }

    if (migrated) {
      seasonData.metadata.updatedAt = new Date().toISOString()
    }
    return true
  }

  /**
   * Update player's team ID in their stats (for AI-to-AI trades where ID
   * doesn't change). Touches both buckets so the team affiliation stays
   * consistent across regular-season and playoff records.
   */
  static updatePlayerStatsTeam(seasonData, playerId, newTeamId) {
    if (!seasonData) return false

    const key = String(playerId)
    let updated = false
    for (const bucketKey of ['playerStats', 'playoffPlayerStats']) {
      const bucket = seasonData[bucketKey]
      if (bucket?.[key]) {
        bucket[key].teamId = newTeamId
        updated = true
      }
    }
    if (updated) {
      seasonData.metadata.updatedAt = new Date().toISOString()
    }
    return updated
  }

  // -----------------------------------------------------------------------
  // Team Stats
  // -----------------------------------------------------------------------

  /**
   * Get team stats.
   */
  static getTeamStats(seasonData, teamId) {
    return seasonData?.teamStats?.[teamId] ?? null
  }

  // -----------------------------------------------------------------------
  // Bulk Operations
  // -----------------------------------------------------------------------

  /**
   * Bulk merge game results into the season.
   * Replaces multiple individual update cycles with a single pass.
   * @param {Object} seasonData - Mutated in place
   * @param {Array} results - Array of result objects with:
   *   { gameId, homeTeamId, awayTeamId, homeScore, awayScore, boxScore,
   *     quarterScores, isUserGame, isPlayoff }
   */
  static bulkMergeResults(seasonData, results) {
    if (!seasonData || !results || results.length === 0) return

    // Build a game_id -> schedule index lookup for fast access
    const scheduleIndex = {}
    for (let idx = 0; idx < seasonData.schedule.length; idx++) {
      scheduleIndex[seasonData.schedule[idx].id] = idx
    }

    for (const result of results) {
      const gameId = result.gameId
      const idx = scheduleIndex[gameId]

      if (idx === undefined) continue

      // Idempotency: skip games already marked complete
      if (seasonData.schedule[idx].isComplete) continue

      // Update schedule entry
      let boxScore = result.boxScore
      if (!result.isUserGame && boxScore) {
        boxScore = SeasonManager.compactBoxScore(boxScore)
      }

      seasonData.schedule[idx] = {
        ...seasonData.schedule[idx],
        isComplete: true,
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        boxScore,
        quarterScores: result.quarterScores,
      }

      // Update standings
      const homeWon = result.homeScore > result.awayScore
      for (const conf of ['east', 'west']) {
        for (let i = 0; i < seasonData.standings[conf].length; i++) {
          const standing = seasonData.standings[conf][i]
          if (standing.teamId === result.homeTeamId) {
            seasonData.standings[conf][i] = SeasonManager._updateTeamStanding(
              standing, homeWon, result.homeScore, result.awayScore, true
            )
          }
          if (standing.teamId === result.awayTeamId) {
            seasonData.standings[conf][i] = SeasonManager._updateTeamStanding(
              standing, !homeWon, result.awayScore, result.homeScore, false
            )
          }
        }
      }

      // Update team stats
      SeasonManager._updateTeamStatsAfterGame(seasonData, result.homeTeamId, result.homeScore, result.awayScore, true)
      SeasonManager._updateTeamStatsAfterGame(seasonData, result.awayTeamId, result.awayScore, result.homeScore, false)

      // Update player stats from full box score. Route to regular-season or
      // playoff bucket based on the per-result flag — playoff games are not
      // counted toward MVP / All-NBA eligibility thresholds.
      const fullBox = result.boxScore // Use full (non-compacted) box score for stats
      const bucket = SeasonManager._getStatsBucket(seasonData, !!result.isPlayoff)
      const sides = { home: result.homeTeamId, away: result.awayTeamId }
      for (const [side, teamId] of Object.entries(sides)) {
        for (const playerStats of (fullBox?.[side] ?? [])) {
          const playerId = playerStats.player_id ?? playerStats.playerId ?? null
          const playerName = playerStats.name ?? 'Unknown'
          if (!playerId) continue

          const pid = String(playerId)
          if (!bucket[pid]) {
            bucket[pid] = SeasonManager._createEmptyPlayerStats(pid, playerName, teamId)
          }

          const s = bucket[pid]
          const mins = playerStats.minutes ?? 0
          if (mins > 0) {
            s.gamesPlayed++
          }
          s.minutesPlayed += mins
          s.points += playerStats.points ?? 0
          s.rebounds += playerStats.rebounds ?? 0
          s.offensiveRebounds += playerStats.offensiveRebounds ?? playerStats.offensive_rebounds ?? 0
          s.defensiveRebounds += playerStats.defensiveRebounds ?? playerStats.defensive_rebounds ?? 0
          s.assists += playerStats.assists ?? 0
          s.steals += playerStats.steals ?? 0
          s.blocks += playerStats.blocks ?? 0
          s.turnovers += playerStats.turnovers ?? 0
          s.personalFouls += playerStats.fouls ?? playerStats.personalFouls ?? 0
          s.fieldGoalsMade += playerStats.fieldGoalsMade ?? playerStats.fgm ?? 0
          s.fieldGoalsAttempted += playerStats.fieldGoalsAttempted ?? playerStats.fga ?? 0
          s.threePointersMade += playerStats.threePointersMade ?? playerStats.fg3m ?? 0
          s.threePointersAttempted += playerStats.threePointersAttempted ?? playerStats.fg3a ?? 0
          s.freeThrowsMade += playerStats.freeThrowsMade ?? playerStats.ftm ?? 0
          s.freeThrowsAttempted += playerStats.freeThrowsAttempted ?? playerStats.fta ?? 0
        }
      }
    }

    // Sort standings once at the end
    for (const conf of ['east', 'west']) {
      seasonData.standings[conf].sort((a, b) => {
        const totalA = a.wins + a.losses
        const totalB = b.wins + b.losses
        const pctA = totalA > 0 ? a.wins / totalA : 0
        const pctB = totalB > 0 ? b.wins / totalB : 0
        if (pctA !== pctB) return pctB - pctA
        const diffA = (a.pointsFor ?? 0) - (a.pointsAgainst ?? 0)
        const diffB = (b.pointsFor ?? 0) - (b.pointsAgainst ?? 0)
        return diffB - diffA
      })
    }

    seasonData.metadata.updatedAt = new Date().toISOString()
  }

  // -----------------------------------------------------------------------
  // Season Status
  // -----------------------------------------------------------------------

  /**
   * Check if regular season is complete.
   */
  static isRegularSeasonComplete(seasonData) {
    const schedule = SeasonManager.getSchedule(seasonData)
    const regularSeasonGames = schedule.filter(g => !(g.isPlayoff ?? false))

    if (regularSeasonGames.length === 0) return false

    return regularSeasonGames.every(g => g.isComplete ?? false)
  }

  /**
   * Get preview data for simulating to the user's next game.
   * @param {Object} seasonData
   * @param {number|string} userTeamId
   * @param {string} currentDateStr - YYYY-MM-DD
   * @returns {Object|null}
   */
  static getSimulateToNextGamePreview(seasonData, userTeamId, currentDateStr) {
    let nextUserGame = SeasonManager.getNextTeamGame(seasonData, userTeamId, currentDateStr)

    // Fallback: if date filter excluded all games, try without it.
    // Handles edge case where currentDate advanced past an unplayed game.
    if (!nextUserGame) {
      nextUserGame = SeasonManager.getNextTeamGame(seasonData, userTeamId, null)
      if (nextUserGame) {
        // Use the found game's date as the effective current date
        currentDateStr = nextUserGame.gameDate
      }
    }

    if (!nextUserGame) return null

    const nextGameDate = nextUserGame.gameDate
    const schedule = SeasonManager.getSchedule(seasonData)
    const gamesByDate = {}

    for (const game of schedule) {
      if (game.isComplete) continue
      if (game.isCancelled) continue
      if (game.gameDate > nextGameDate) continue

      // Include any AI game from prior dates that was missed — e.g. if the
      // background `_simulateAiGamesForDay` was interrupted by navigation /
      // refresh and the campaign date later advanced past it. Without this
      // catch-up, AI teams can fall behind the user's game count over a
      // season. We never include the user's own past games (those are
      // genuinely already finished or in-progress).
      if (game.gameDate < currentDateStr) {
        if (game.homeTeamId === userTeamId || game.awayTeamId === userTeamId) continue
      }

      // Skip the user's own game on game day
      if (game.gameDate === nextGameDate &&
          (game.homeTeamId === userTeamId || game.awayTeamId === userTeamId)) {
        continue
      }

      if (!gamesByDate[game.gameDate]) gamesByDate[game.gameDate] = []
      gamesByDate[game.gameDate].push(game)
    }

    // Sort dates
    const sortedDates = Object.keys(gamesByDate).sort()
    const sortedGamesByDate = {}
    for (const d of sortedDates) {
      sortedGamesByDate[d] = gamesByDate[d]
    }

    let totalGamesToSimulate = 0
    for (const games of Object.values(sortedGamesByDate)) {
      totalGamesToSimulate += games.length
    }

    return {
      nextUserGame,
      daysToSimulate: Object.keys(sortedGamesByDate).length,
      gamesByDate: sortedGamesByDate,
      totalGamesToSimulate,
    }
  }

  // -----------------------------------------------------------------------
  // Playoff Bracket Helpers
  // -----------------------------------------------------------------------

  /**
   * Get the playoff bracket from season data.
   */
  static getPlayoffBracket(seasonData) {
    return seasonData?.playoffBracket ?? null
  }

  /**
   * Set the playoff bracket on season data.
   */
  static setPlayoffBracket(seasonData, bracket) {
    if (seasonData) {
      seasonData.playoffBracket = bracket
      seasonData.metadata.updatedAt = new Date().toISOString()
    }
  }
}

// ---------------------------------------------------------------------------
// Date Helpers (simple, no external dependencies)
// ---------------------------------------------------------------------------

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(date, n) {
  const result = new Date(date)
  result.setDate(result.getDate() + n)
  return result
}

function daysBetween(a, b) {
  const msPerDay = 86400000
  return Math.floor((b - a) / msPerDay)
}

/**
 * Fisher-Yates shuffle (in place).
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Pick a set of pairs from `teamIds` such that every team appears in exactly
 * `targetDegree` pairs — i.e. a `targetDegree`-regular subgraph of K_n.
 *
 * Construction: shuffle the team IDs onto a ring of n positions, then pick
 * `targetDegree / 2` random distances d ∈ {1..⌊n/2⌋}. For each distance d,
 * draw an edge from position i to position (i + d) mod n for every i. Each
 * distance contributes degree 2 per vertex, so two distances give degree 4.
 *
 * Requires `targetDegree` to be even, and n × targetDegree to be even
 * (which it always will be when targetDegree is even).
 *
 * Used by the schedule generator: the picked pairs become the 3-game series,
 * everything else is a 4-game series — guaranteeing each team exactly
 * `targetDegree` three-game opponents.
 */
function selectThreeGamePairs(teamIds, targetDegree) {
  const n = teamIds.length
  if (targetDegree % 2 !== 0) {
    throw new Error(`selectThreeGamePairs requires even targetDegree, got ${targetDegree}`)
  }
  const distancesNeeded = targetDegree / 2
  const maxDistance = Math.floor(n / 2)
  if (distancesNeeded > maxDistance) {
    throw new Error(`Cannot pick ${distancesNeeded} distances from {1..${maxDistance}}`)
  }

  const ring = shuffleArray([...teamIds])
  const allDistances = Array.from({ length: maxDistance }, (_, i) => i + 1)
  const distances = shuffleArray(allDistances).slice(0, distancesNeeded)

  // Even n with distance n/2 doubles each edge — only safe when n is odd or
  // when n/2 is not in the picked set. For the basketball case (n = 15) we
  // can never pick d = 7.5, so this is structurally fine.
  const pairs = []
  for (let i = 0; i < n; i++) {
    for (const d of distances) {
      const j = (i + d) % n
      pairs.push([ring[i], ring[j]])
    }
  }
  return pairs
}

export default SeasonManager
