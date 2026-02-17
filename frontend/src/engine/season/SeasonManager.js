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

    // Build matchups targeting 54 games per team
    const targetGamesPerTeam = 54
    const matchups = []

    // Generate one game per unique pair with random home/away
    for (let i = 0; i < teamIds.length; i++) {
      for (let j = i + 1; j < teamIds.length; j++) {
        if (Math.random() < 0.5) {
          matchups.push({ homeTeamId: teamIds[i], awayTeamId: teamIds[j] })
        } else {
          matchups.push({ homeTeamId: teamIds[j], awayTeamId: teamIds[i] })
        }
      }
    }

    // Add extra same-conference games to reach 54 per team
    const teamGameCounts = {}
    for (const id of teamIds) {
      teamGameCounts[id] = teamIds.length - 1
    }

    // Group teams by conference
    const conferenceGroups = {}
    for (const id of teamIds) {
      const conf = teamConferences[id]
      if (!conferenceGroups[conf]) conferenceGroups[conf] = []
      conferenceGroups[conf].push(id)
    }

    for (const confTeams of Object.values(conferenceGroups)) {
      // Build all same-conference pairs
      const pairs = []
      for (let i = 0; i < confTeams.length; i++) {
        for (let j = i + 1; j < confTeams.length; j++) {
          pairs.push([confTeams[i], confTeams[j]])
        }
      }

      // Add extra games until all conference teams reach target
      const maxPasses = 100
      for (let pass = 0; pass < maxPasses; pass++) {
        shuffleArray(pairs)
        let addedAny = false
        for (const pair of pairs) {
          if (teamGameCounts[pair[0]] < targetGamesPerTeam &&
              teamGameCounts[pair[1]] < targetGamesPerTeam) {
            if (Math.random() < 0.5) {
              matchups.push({ homeTeamId: pair[0], awayTeamId: pair[1] })
            } else {
              matchups.push({ homeTeamId: pair[1], awayTeamId: pair[0] })
            }
            teamGameCounts[pair[0]]++
            teamGameCounts[pair[1]]++
            addedAny = true
          }
        }
        if (!addedAny) break
        const confCounts = confTeams.map(id => teamGameCounts[id])
        if (Math.min(...confCounts) >= targetGamesPerTeam) break
      }
    }

    // Distribute games across season ensuring no team plays twice on the same day
    shuffleArray(matchups)
    const gamesPerDay = 10
    let currentDate = parseDate(startDateStr)
    const schedule = []
    let gameNumber = 1
    let remaining = [...matchups]
    let userLastGameDate = null

    while (remaining.length > 0) {
      const dayGames = []
      const teamsPlayingToday = []
      let unscheduled = []
      const dateStr = formatDate(currentDate)

      // Check if user team needs a game today (gap would exceed 2 days)
      let userNeedsGame = false
      if (userLastGameDate !== null) {
        const daysSinceUserGame = daysBetween(userLastGameDate, currentDate)
        if (daysSinceUserGame >= 2) {
          userNeedsGame = true
        }
      } else {
        // User hasn't played yet — schedule ASAP
        userNeedsGame = true
      }

      // If user needs a game, try to schedule one first
      if (userNeedsGame) {
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
            userLastGameDate = new Date(currentDate)
          } else {
            stillRemaining.push(matchup)
          }
        }
        remaining = stillRemaining
      }

      // Fill remaining slots for the day
      for (const matchup of remaining) {
        const home = matchup.homeTeamId
        const away = matchup.awayTeamId

        if (dayGames.length >= gamesPerDay ||
            teamsPlayingToday.includes(home) ||
            teamsPlayingToday.includes(away)) {
          unscheduled.push(matchup)
          continue
        }

        dayGames.push(matchup)
        teamsPlayingToday.push(home, away)
      }

      for (const matchup of dayGames) {
        const gameId = `game_${year}_${String(gameNumber).padStart(4, '0')}`

        // Track user team's last game date
        if (matchup.homeTeamId === userTeamId || matchup.awayTeamId === userTeamId) {
          userLastGameDate = new Date(currentDate)
        }

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
   * Update player stats after a game.
   * Mutates seasonData in place.
   */
  static updatePlayerStats(seasonData, playerId, playerName, teamId, gameStats) {
    if (!seasonData) return

    const pid = String(playerId)

    if (!seasonData.playerStats[pid]) {
      seasonData.playerStats[pid] = SeasonManager._createEmptyPlayerStats(pid, playerName, teamId)
    }

    const stats = seasonData.playerStats[pid]

    stats.gamesPlayed++
    stats.minutesPlayed += gameStats.minutes ?? 0
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
   * Get a single player's stats.
   */
  static getPlayerStats(seasonData, playerId) {
    return seasonData?.playerStats?.[String(playerId)] ?? null
  }

  /**
   * Get all player stats for a season.
   */
  static getAllPlayerStats(seasonData) {
    return seasonData?.playerStats ?? {}
  }

  /**
   * Migrate player stats from one player ID to another (used during trades).
   */
  static migratePlayerStats(seasonData, oldPlayerId, newPlayerId, newTeamId, newPlayerName) {
    if (!seasonData) return false

    const oldKey = String(oldPlayerId)
    const newKey = String(newPlayerId)

    const oldStats = seasonData.playerStats[oldKey]
    if (!oldStats) {
      return true // No stats to migrate, not an error
    }

    seasonData.playerStats[newKey] = {
      ...oldStats,
      playerId: newKey,
      playerName: newPlayerName,
      teamId: newTeamId,
    }

    delete seasonData.playerStats[oldKey]
    seasonData.metadata.updatedAt = new Date().toISOString()

    return true
  }

  /**
   * Update player's team ID in their stats (for AI-to-AI trades where ID doesn't change).
   */
  static updatePlayerStatsTeam(seasonData, playerId, newTeamId) {
    if (!seasonData) return false

    const key = String(playerId)
    if (seasonData.playerStats[key]) {
      seasonData.playerStats[key].teamId = newTeamId
      seasonData.metadata.updatedAt = new Date().toISOString()
      return true
    }

    return false
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
   *   { gameId, homeTeamId, awayTeamId, homeScore, awayScore, boxScore, quarterScores, isUserGame }
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

      // Update player stats from full box score
      const fullBox = result.boxScore // Use full (non-compacted) box score for stats
      const sides = { home: result.homeTeamId, away: result.awayTeamId }
      for (const [side, teamId] of Object.entries(sides)) {
        for (const playerStats of (fullBox?.[side] ?? [])) {
          const playerId = playerStats.player_id ?? playerStats.playerId ?? null
          const playerName = playerStats.name ?? 'Unknown'
          if (!playerId) continue

          const pid = String(playerId)
          if (!seasonData.playerStats[pid]) {
            seasonData.playerStats[pid] = SeasonManager._createEmptyPlayerStats(pid, playerName, teamId)
          }

          const s = seasonData.playerStats[pid]
          s.gamesPlayed++
          s.minutesPlayed += playerStats.minutes ?? 0
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
      if (game.gameDate < currentDateStr) continue
      if (game.gameDate > nextGameDate) continue

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

export default SeasonManager
