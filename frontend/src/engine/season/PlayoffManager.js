import { SeasonManager } from './SeasonManager'

// ---------------------------------------------------------------------------
// PlayoffManager
// ---------------------------------------------------------------------------
// Manages playoff bracket generation, series management, advancement logic,
// and playoff schedule generation. All data is passed in and returned as
// plain objects — no file I/O or database access.
// ---------------------------------------------------------------------------

export class PlayoffManager {

  // -----------------------------------------------------------------------
  // Bracket Generation
  // -----------------------------------------------------------------------

  /**
   * Generate the playoff bracket based on final standings.
   * @param {Object} seasonData - Season data object (mutated: playoffBracket is set)
   * @param {Array} teams - All team objects [{ id, name, city, abbreviation, conference, primary_color, ... }]
   * @returns {Object} The generated bracket
   */
  static generatePlayoffBracket(seasonData, teams) {
    const standings = SeasonManager.getStandings(seasonData)

    // Get top 8 from each conference
    const eastTeams = PlayoffManager._getPlayoffTeams(standings.east, teams)
    const westTeams = PlayoffManager._getPlayoffTeams(standings.west, teams)

    const bracket = {
      east: {
        round1: [
          PlayoffManager._createMatchup(eastTeams[0], eastTeams[7], 'east', 1, 'E_R1_1v8'),
          PlayoffManager._createMatchup(eastTeams[3], eastTeams[4], 'east', 1, 'E_R1_4v5'),
          PlayoffManager._createMatchup(eastTeams[2], eastTeams[5], 'east', 1, 'E_R1_3v6'),
          PlayoffManager._createMatchup(eastTeams[1], eastTeams[6], 'east', 1, 'E_R1_2v7'),
        ],
        round2: [],
        confFinals: null,
        confFinalsMVP: null,
      },
      west: {
        round1: [
          PlayoffManager._createMatchup(westTeams[0], westTeams[7], 'west', 1, 'W_R1_1v8'),
          PlayoffManager._createMatchup(westTeams[3], westTeams[4], 'west', 1, 'W_R1_4v5'),
          PlayoffManager._createMatchup(westTeams[2], westTeams[5], 'west', 1, 'W_R1_3v6'),
          PlayoffManager._createMatchup(westTeams[1], westTeams[6], 'west', 1, 'W_R1_2v7'),
        ],
        round2: [],
        confFinals: null,
        confFinalsMVP: null,
      },
      finals: null,
      finalsMVP: null,
      champion: null,
    }

    seasonData.playoffBracket = bracket
    seasonData.metadata.updatedAt = new Date().toISOString()

    return bracket
  }

  /**
   * Get playoff teams from conference standings (top 8).
   * @private
   */
  static _getPlayoffTeams(conferenceStandings, allTeams) {
    // Sort by win percentage descending, then point differential as tiebreaker
    const sorted = [...conferenceStandings].sort((a, b) => {
      const totalA = a.wins + a.losses
      const totalB = b.wins + b.losses
      const pctA = totalA > 0 ? a.wins / totalA : 0
      const pctB = totalB > 0 ? b.wins / totalB : 0
      if (pctA !== pctB) return pctB - pctA
      const diffA = (a.pointsFor ?? 0) - (a.pointsAgainst ?? 0)
      const diffB = (b.pointsFor ?? 0) - (b.pointsAgainst ?? 0)
      return diffB - diffA
    })

    const top8 = sorted.slice(0, 8)

    // Build lookup from all teams by id
    const teamsById = {}
    for (const t of allTeams) {
      teamsById[t.id] = t
    }

    const playoffTeams = []
    for (let index = 0; index < top8.length; index++) {
      const standing = top8[index]
      const team = teamsById[standing.teamId]
      if (team) {
        playoffTeams.push({
          teamId: team.id,
          seed: index + 1,
          name: team.name,
          city: team.city,
          abbreviation: team.abbreviation,
          primaryColor: team.primary_color ?? team.primaryColor ?? '#6B7280',
          wins: standing.wins,
          losses: standing.losses,
        })
      }
    }

    return playoffTeams
  }

  /**
   * Create a playoff matchup structure.
   * @private
   */
  static _createMatchup(higherSeed, lowerSeed, conference, round, seriesId) {
    return {
      seriesId,
      conference,
      round,
      team1: higherSeed,
      team2: lowerSeed,
      team1Wins: 0,
      team2Wins: 0,
      games: [],
      status: 'pending',
      winner: null,
      seriesMVP: null,
    }
  }

  // -----------------------------------------------------------------------
  // Playoff Schedule Generation
  // -----------------------------------------------------------------------

  /**
   * Generate playoff schedule for a round.
   * @param {Object} seasonData - Mutated in place (schedule + bracket updated)
   * @param {Array} teams - All team objects
   * @param {number} round - Playoff round (1-4)
   * @param {number} year - Season year
   * @returns {number} Number of games created
   */
  static generatePlayoffSchedule(seasonData, teams, round, year) {
    const bracket = seasonData.playoffBracket
    if (!bracket) return 0

    // Build team lookup by id
    const teamsById = {}
    for (const t of teams) {
      teamsById[t.id] = t
    }

    const schedule = seasonData.schedule ?? []
    let gameNumber = schedule.length + 1
    let gamesCreated = 0

    // Determine start date (after last scheduled game)
    const lastGame = schedule.length > 0 ? schedule[schedule.length - 1] : null
    let startDate
    if (lastGame) {
      startDate = addDays(parseDate(lastGame.gameDate), 3)
    } else {
      startDate = parseDate('2026-04-15')
    }

    // Get series for this round
    const allSeries = PlayoffManager._getSeriesForRound(bracket, round)

    for (const series of allSeries) {
      if (series.status !== 'pending') continue

      const homeTeam = teamsById[series.team1.teamId]
      const awayTeam = teamsById[series.team2.teamId]
      if (!homeTeam || !awayTeam) continue

      // Schedule 7 potential games (2-2-1-1-1 format)
      const homeAwayPattern = [true, true, false, false, true, false, true]
      let gameDate = new Date(startDate)
      const seriesGames = []

      for (let gameNum = 1; gameNum <= 7; gameNum++) {
        const isHomeGame = homeAwayPattern[gameNum - 1]
        const gameId = `game_${year}_${String(gameNumber).padStart(4, '0')}`

        const game = {
          id: gameId,
          homeTeamId: isHomeGame ? series.team1.teamId : series.team2.teamId,
          homeTeamAbbreviation: isHomeGame ? homeTeam.abbreviation : awayTeam.abbreviation,
          awayTeamId: isHomeGame ? series.team2.teamId : series.team1.teamId,
          awayTeamAbbreviation: isHomeGame ? awayTeam.abbreviation : homeTeam.abbreviation,
          gameDate: formatDate(gameDate),
          isPlayoff: true,
          playoffRound: round,
          playoffSeriesId: series.seriesId,
          playoffGameNumber: gameNum,
          isComplete: false,
          homeScore: null,
          awayScore: null,
          boxScore: null,
        }

        schedule.push(game)
        seriesGames.push(gameId)
        gameNumber++
        gamesCreated++

        // Games every 2 days, extra day for travel games
        const extraDays = (gameNum === 2 || gameNum === 4) ? 3 : 2
        gameDate = addDays(gameDate, extraDays)
      }

      // Update series with game IDs
      PlayoffManager._updateSeriesGames(seasonData, series.seriesId, seriesGames)
    }

    seasonData.schedule = schedule
    seasonData.metadata.updatedAt = new Date().toISOString()

    return gamesCreated
  }

  /**
   * Get all series for a given round.
   * @private
   */
  static _getSeriesForRound(bracket, round) {
    const series = []

    if (round === 1) {
      series.push(...bracket.east.round1, ...bracket.west.round1)
    } else if (round === 2) {
      series.push(...(bracket.east.round2 ?? []), ...(bracket.west.round2 ?? []))
    } else if (round === 3) {
      if (bracket.east.confFinals) series.push(bracket.east.confFinals)
      if (bracket.west.confFinals) series.push(bracket.west.confFinals)
    } else if (round === 4) {
      if (bracket.finals) series.push(bracket.finals)
    }

    return series
  }

  /**
   * Update series with game IDs and set to in_progress.
   * @private
   */
  static _updateSeriesGames(seasonData, seriesId, gameIds) {
    const bracket = seasonData.playoffBracket

    for (const conf of ['east', 'west']) {
      for (const round of ['round1', 'round2']) {
        if (!bracket[conf][round]) continue
        for (let i = 0; i < bracket[conf][round].length; i++) {
          if (bracket[conf][round][i].seriesId === seriesId) {
            bracket[conf][round][i].games = gameIds
            bracket[conf][round][i].status = 'in_progress'
            return
          }
        }
      }
      if (bracket[conf].confFinals?.seriesId === seriesId) {
        bracket[conf].confFinals.games = gameIds
        bracket[conf].confFinals.status = 'in_progress'
        return
      }
    }

    if (bracket.finals?.seriesId === seriesId) {
      bracket.finals.games = gameIds
      bracket.finals.status = 'in_progress'
    }
  }

  // -----------------------------------------------------------------------
  // Series Updates
  // -----------------------------------------------------------------------

  /**
   * Update series after a game is completed.
   * @param {Object} seasonData - Mutated in place
   * @param {Object} game - The completed game object
   * @param {number} homeScore
   * @param {number} awayScore
   * @returns {Object|null} Result info, or null if not a playoff game
   */
  static updateSeriesAfterGame(seasonData, game, homeScore, awayScore) {
    if (!(game.isPlayoff ?? false) || !game.playoffSeriesId) {
      return null
    }

    const bracket = seasonData.playoffBracket
    const seriesId = game.playoffSeriesId
    const series = PlayoffManager._findSeriesById(bracket, seriesId)

    if (!series) return null

    // Determine winner
    const homeTeamId = game.homeTeamId
    const team1Won = (homeTeamId === series.team1.teamId && homeScore > awayScore) ||
                     (homeTeamId === series.team2.teamId && awayScore > homeScore)

    if (team1Won) {
      series.team1Wins++
    } else {
      series.team2Wins++
    }

    // Check if series is complete
    const seriesComplete = series.team1Wins >= 4 || series.team2Wins >= 4

    if (seriesComplete) {
      series.status = 'complete'
      series.winner = series.team1Wins >= 4 ? series.team1 : series.team2

      // Calculate series MVP
      const mvp = PlayoffManager.calculateSeriesMVP(seasonData, series)
      series.seriesMVP = mvp
    }

    // Update series in bracket
    PlayoffManager._updateSeriesInBracket(bracket, seriesId, series)

    seasonData.playoffBracket = bracket
    seasonData.metadata.updatedAt = new Date().toISOString()

    const result = {
      seriesId,
      series,
      seriesComplete,
      round: game.playoffRound,
    }

    if (seriesComplete) {
      result.winner = series.winner
      result.seriesMVP = series.seriesMVP

      if (game.playoffRound === 3) {
        result.isConferenceFinals = true
      } else if (game.playoffRound === 4) {
        result.isFinals = true
        result.isChampion = true
      }
    }

    return result
  }

  /**
   * Find a series by its ID in the bracket.
   * @private
   */
  static _findSeriesById(bracket, seriesId) {
    for (const conf of ['east', 'west']) {
      for (const round of ['round1', 'round2']) {
        if (!bracket[conf][round]) continue
        for (const series of bracket[conf][round]) {
          if (series.seriesId === seriesId) return series
        }
      }
      if (bracket[conf].confFinals?.seriesId === seriesId) {
        return bracket[conf].confFinals
      }
    }

    if (bracket.finals?.seriesId === seriesId) {
      return bracket.finals
    }

    return null
  }

  /**
   * Update a series in the bracket.
   * @private
   */
  static _updateSeriesInBracket(bracket, seriesId, updatedSeries) {
    for (const conf of ['east', 'west']) {
      for (const round of ['round1', 'round2']) {
        if (!bracket[conf][round]) continue
        for (let i = 0; i < bracket[conf][round].length; i++) {
          if (bracket[conf][round][i].seriesId === seriesId) {
            bracket[conf][round][i] = updatedSeries
            return
          }
        }
      }
      if (bracket[conf].confFinals?.seriesId === seriesId) {
        bracket[conf].confFinals = updatedSeries
        return
      }
    }

    if (bracket.finals?.seriesId === seriesId) {
      bracket.finals = updatedSeries
    }
  }

  // -----------------------------------------------------------------------
  // Series MVP
  // -----------------------------------------------------------------------

  /**
   * Calculate the series MVP based on aggregate stats.
   * Score = (PTS * 1.0) + (REB * 1.2) + (AST * 1.5) + (STL * 3.0) + (BLK * 3.0) - (TO * 1.5)
   * @param {Object} seasonData
   * @param {Object} series
   * @returns {Object|null}
   */
  static calculateSeriesMVP(seasonData, series) {
    if (!seasonData || !series.games || series.games.length === 0) {
      return null
    }

    const winningTeamId = series.winner?.teamId ?? null
    if (!winningTeamId) return null

    // Aggregate stats for all players from winning team across series games
    const playerStats = {}

    for (const gameId of series.games) {
      const game = SeasonManager.getGame(seasonData, gameId)
      if (!game || !game.isComplete || !game.boxScore) continue

      // Determine which side the winning team was on
      const side = game.homeTeamId == winningTeamId ? 'home' : 'away'

      for (const playerGame of (game.boxScore[side] ?? [])) {
        const playerId = playerGame.player_id ?? playerGame.playerId ?? null
        if (!playerId) continue

        if (!playerStats[playerId]) {
          playerStats[playerId] = {
            playerId,
            name: playerGame.name ?? 'Unknown',
            points: 0,
            rebounds: 0,
            assists: 0,
            steals: 0,
            blocks: 0,
            turnovers: 0,
            games: 0,
          }
        }

        playerStats[playerId].points += playerGame.points ?? 0
        playerStats[playerId].rebounds += playerGame.rebounds ?? 0
        playerStats[playerId].assists += playerGame.assists ?? 0
        playerStats[playerId].steals += playerGame.steals ?? 0
        playerStats[playerId].blocks += playerGame.blocks ?? 0
        playerStats[playerId].turnovers += playerGame.turnovers ?? 0
        playerStats[playerId].games++
      }
    }

    if (Object.keys(playerStats).length === 0) return null

    // Calculate MVP score for each player
    let bestPlayer = null
    let bestScore = -999

    for (const stats of Object.values(playerStats)) {
      if (stats.games < 2) continue // Must have played at least 2 games

      const score = (stats.points * 1.0)
                  + (stats.rebounds * 1.2)
                  + (stats.assists * 1.5)
                  + (stats.steals * 3.0)
                  + (stats.blocks * 3.0)
                  - (stats.turnovers * 1.5)

      if (score > bestScore) {
        bestScore = score
        bestPlayer = stats
      }
    }

    if (!bestPlayer) return null

    const games = bestPlayer.games
    return {
      playerId: bestPlayer.playerId,
      name: bestPlayer.name,
      teamId: winningTeamId,
      ppg: Math.round((bestPlayer.points / games) * 10) / 10,
      rpg: Math.round((bestPlayer.rebounds / games) * 10) / 10,
      apg: Math.round((bestPlayer.assists / games) * 10) / 10,
      spg: Math.round((bestPlayer.steals / games) * 10) / 10,
      bpg: Math.round((bestPlayer.blocks / games) * 10) / 10,
      mvpScore: Math.round(bestScore * 10) / 10,
    }
  }

  // -----------------------------------------------------------------------
  // Advancement
  // -----------------------------------------------------------------------

  /**
   * Advance winner to next round.
   * @param {Object} seasonData - Mutated in place
   * @param {Object} completedSeries - Result from updateSeriesAfterGame
   */
  static advanceWinnerToNextRound(seasonData, completedSeries) {
    const bracket = seasonData.playoffBracket
    const series = completedSeries.series
    const round = completedSeries.round
    const conference = series.conference ?? null

    if (round === 1) {
      PlayoffManager._createRound2MatchupIfReady(bracket, conference)
    } else if (round === 2) {
      PlayoffManager._createConferenceFinals(bracket, conference)
    } else if (round === 3) {
      PlayoffManager._createFinalsIfReady(bracket)
    } else if (round === 4) {
      bracket.champion = series.winner
    }

    seasonData.playoffBracket = bracket
    seasonData.metadata.updatedAt = new Date().toISOString()
  }

  /**
   * Create round 2 matchup when both required round 1 series are complete.
   * @private
   */
  static _createRound2MatchupIfReady(bracket, conference) {
    const round1 = bracket[conference].round1

    // Check 1v8 and 4v5 matchup
    const series1 = round1[0] // 1v8
    const series2 = round1[1] // 4v5
    if (series1.status === 'complete' && series2.status === 'complete' &&
        bracket[conference].round2.length < 1) {
      const confPrefix = conference.charAt(0).toUpperCase()
      bracket[conference].round2.push(
        PlayoffManager._createMatchup(
          series1.winner,
          series2.winner,
          conference,
          2,
          `${confPrefix}_R2_A`
        )
      )
    }

    // Check 3v6 and 2v7 matchup
    const series3 = round1[2] // 3v6
    const series4 = round1[3] // 2v7
    if (series3.status === 'complete' && series4.status === 'complete' &&
        bracket[conference].round2.length < 2) {
      const confPrefix = conference.charAt(0).toUpperCase()
      bracket[conference].round2.push(
        PlayoffManager._createMatchup(
          series4.winner, // 2v7 winner (higher seed branch)
          series3.winner, // 3v6 winner
          conference,
          2,
          `${confPrefix}_R2_B`
        )
      )
    }
  }

  /**
   * Create conference finals when both round 2 series are complete.
   * @private
   */
  static _createConferenceFinals(bracket, conference) {
    const round2 = bracket[conference].round2 ?? []
    if (round2.length < 2) return

    const series1 = round2[0]
    const series2 = round2[1]

    if (series1.status === 'complete' && series2.status === 'complete' &&
        !bracket[conference].confFinals) {
      const confPrefix = conference.charAt(0).toUpperCase()
      bracket[conference].confFinals = PlayoffManager._createMatchup(
        series1.winner,
        series2.winner,
        conference,
        3,
        `${confPrefix}_CF`
      )
    }
  }

  /**
   * Create NBA Finals when both conference finals are complete.
   * @private
   */
  static _createFinalsIfReady(bracket) {
    const eastCF = bracket.east.confFinals
    const westCF = bracket.west.confFinals

    if (eastCF && westCF &&
        eastCF.status === 'complete' && westCF.status === 'complete' &&
        !bracket.finals) {
      bracket.finals = PlayoffManager._createMatchup(
        eastCF.winner,
        westCF.winner,
        'finals',
        4,
        'FINALS'
      )
    }
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Get the current playoff bracket.
   */
  static getBracket(seasonData) {
    return seasonData?.playoffBracket ?? null
  }

  /**
   * Get a specific series by ID.
   */
  static getSeries(seasonData, seriesId) {
    const bracket = PlayoffManager.getBracket(seasonData)
    if (!bracket) return null
    return PlayoffManager._findSeriesById(bracket, seriesId)
  }

  /**
   * Check if regular season is complete (delegates to SeasonManager).
   */
  static isRegularSeasonComplete(seasonData) {
    return SeasonManager.isRegularSeasonComplete(seasonData)
  }

  /**
   * Get user's playoff status (qualification, seed, opponent).
   * @param {Object} seasonData
   * @param {number|string} userTeamId
   * @param {Array} teams - All team objects
   * @returns {Object}
   */
  static getUserPlayoffStatus(seasonData, userTeamId, teams) {
    const standings = SeasonManager.getStandings(seasonData)

    let userStanding = null
    let userConference = null
    let seed = null

    for (const conf of ['east', 'west']) {
      const sorted = [...standings[conf]].sort((a, b) => {
        const totalA = a.wins + a.losses
        const totalB = b.wins + b.losses
        const pctA = totalA > 0 ? a.wins / totalA : 0
        const pctB = totalB > 0 ? b.wins / totalB : 0
        if (pctA !== pctB) return pctB - pctA
        const diffA = (a.pointsFor ?? 0) - (a.pointsAgainst ?? 0)
        const diffB = (b.pointsFor ?? 0) - (b.pointsAgainst ?? 0)
        return diffB - diffA
      })

      for (let index = 0; index < sorted.length; index++) {
        if (sorted[index].teamId == userTeamId) {
          userStanding = sorted[index]
          userConference = conf
          seed = index + 1
          break
        }
      }
      if (userStanding) break
    }

    if (!userStanding) {
      return { qualified: false }
    }

    const qualified = seed <= 8

    const result = {
      qualified,
      seed,
      conference: userConference,
      wins: userStanding.wins,
      losses: userStanding.losses,
    }

    if (qualified) {
      const opponents = { 1: 8, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1 }
      const opponentSeed = opponents[seed]

      const confStandings = [...standings[userConference]].sort((a, b) => {
        const totalA = a.wins + a.losses
        const totalB = b.wins + b.losses
        const pctA = totalA > 0 ? a.wins / totalA : 0
        const pctB = totalB > 0 ? b.wins / totalB : 0
        if (pctA !== pctB) return pctB - pctA
        const diffA = (a.pointsFor ?? 0) - (a.pointsAgainst ?? 0)
        const diffB = (b.pointsFor ?? 0) - (b.pointsAgainst ?? 0)
        return diffB - diffA
      })

      if (confStandings[opponentSeed - 1]) {
        const opponentStanding = confStandings[opponentSeed - 1]
        // Find team info from teams array
        const opponent = teams.find(t => t.id === opponentStanding.teamId || t.id == opponentStanding.teamId)

        if (opponent) {
          result.opponent = {
            teamId: opponent.id,
            name: opponent.name,
            abbreviation: opponent.abbreviation,
            seed: opponentSeed,
            wins: opponentStanding.wins,
            losses: opponentStanding.losses,
          }
        }
      }
    }

    return result
  }

  /**
   * Get the next incomplete playoff series for the user's team.
   * @param {Object} seasonData
   * @param {number|string} userTeamId
   * @returns {Object|null}
   */
  static getNextUserSeries(seasonData, userTeamId) {
    const bracket = PlayoffManager.getBracket(seasonData)
    if (!bracket) return null

    const allSeries = []

    for (const conf of ['east', 'west']) {
      for (const series of (bracket[conf].round1 ?? [])) {
        allSeries.push(series)
      }
      for (const series of (bracket[conf].round2 ?? [])) {
        allSeries.push(series)
      }
      if (bracket[conf].confFinals) {
        allSeries.push(bracket[conf].confFinals)
      }
    }

    if (bracket.finals) {
      allSeries.push(bracket.finals)
    }

    for (const series of allSeries) {
      if (series.status !== 'complete' &&
          (series.team1.teamId == userTeamId || series.team2.teamId == userTeamId)) {
        return series
      }
    }

    return null
  }

  // -----------------------------------------------------------------------
  // Award Persistence Helpers
  // -----------------------------------------------------------------------

  /**
   * Add a player award to a players collection.
   * Returns the updated player object or null if not found.
   * @param {Array} players - Array of player objects (mutated)
   * @param {string|number} playerId
   * @param {string} awardType - e.g. 'finals_mvp', 'conference_finals_mvp', 'championship'
   * @param {number} year
   * @returns {Object|null} Updated player or null
   */
  static addPlayerAward(players, playerId, awardType, year) {
    for (const player of players) {
      if (String(player.id) === String(playerId)) {
        if (!player.awards) player.awards = {}
        if (!player.awards[awardType]) player.awards[awardType] = []
        player.awards[awardType].push(year)
        return player
      }
    }
    return null
  }

  /**
   * Add championship award to all players on a team's roster.
   * @param {Array} players - Array of player objects (mutated)
   * @param {number|string} teamId
   * @param {number} year
   */
  static addChampionshipToRoster(players, teamId, year) {
    for (const player of players) {
      const playerTeamId = player.team_id ?? player.teamId
      if (String(playerTeamId) === String(teamId)) {
        if (!player.awards) player.awards = {}
        if (!player.awards.championship) player.awards.championship = []
        player.awards.championship.push(year)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Date Helpers
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

export default PlayoffManager
