// ---------------------------------------------------------------------------
// NewsService
// ---------------------------------------------------------------------------
// Generates game news events based on game results and notable performances.
// All data is passed in and returned as plain objects — no database access.
// Each method returns a news event object that the caller can persist.
// ---------------------------------------------------------------------------

export class NewsService {

  /**
   * Create news for a game-winning shot.
   *
   * @param {Object} params
   * @param {Object} params.player - Player who hit the winner { id, firstName/first_name, lastName/last_name }
   * @param {Object} params.homeTeam - { id, name }
   * @param {Object} params.awayTeam - { id, name }
   * @param {number} params.homeScore
   * @param {number} params.awayScore
   * @param {boolean} params.isHomeTeam - Whether the player's team is the home team
   * @param {string} params.shotType - e.g. "three-pointer", "layup", "jumper"
   * @param {string} params.gameDate - YYYY-MM-DD
   * @returns {Object} News event object
   */
  static createGameWinnerNews({ player, homeTeam, awayTeam, homeScore, awayScore, isHomeTeam, shotType, gameDate }) {
    const playerName = `${player.firstName ?? player.first_name ?? 'Unknown'} ${player.lastName ?? player.last_name ?? 'Player'}`
    const winningTeam = isHomeTeam ? homeTeam.name : awayTeam.name
    const losingTeam = isHomeTeam ? awayTeam.name : homeTeam.name

    const headlines = [
      `${playerName} hits game-winner! ${winningTeam} defeats ${losingTeam}`,
      `Clutch! ${playerName} lifts ${winningTeam} to victory`,
      `${playerName}'s ${shotType} sinks ${losingTeam} at the buzzer`,
    ]

    const headline = headlines[Math.floor(Math.random() * headlines.length)]

    return {
      playerId: NewsService._resolvePlayerId(player),
      teamId: isHomeTeam ? (homeTeam.id ?? null) : (awayTeam.id ?? null),
      eventType: 'game_winner',
      headline,
      body: `${playerName} hit a clutch ${shotType} to give the ${winningTeam} a ${homeScore}-${awayScore} victory over the ${losingTeam}.`,
      gameDate,
    }
  }

  /**
   * Create news for overtime thriller.
   *
   * @param {Object} params
   * @param {Object} params.homeTeam - { id, name }
   * @param {Object} params.awayTeam - { id, name }
   * @param {number} params.homeScore
   * @param {number} params.awayScore
   * @param {number} params.overtimePeriods
   * @param {string} params.gameDate - YYYY-MM-DD
   * @returns {Object} News event object
   */
  static createOvertimeThrillerNews({ homeTeam, awayTeam, homeScore, awayScore, overtimePeriods, gameDate }) {
    const winner = homeScore > awayScore ? homeTeam.name : awayTeam.name
    const loser = homeScore > awayScore ? awayTeam.name : homeTeam.name
    const otText = overtimePeriods > 1 ? `${overtimePeriods}OT` : 'OT'

    return {
      teamId: homeScore > awayScore ? (homeTeam.id ?? null) : (awayTeam.id ?? null),
      eventType: 'general',
      headline: `${winner} outlasts ${loser} in ${otText} thriller`,
      body: `In an instant classic, the ${winner} defeated the ${loser} ${homeScore}-${awayScore} after ${overtimePeriods} overtime period(s).`,
      gameDate,
    }
  }

  /**
   * Create news for a blowout victory.
   *
   * @param {Object} params
   * @param {Object} params.winnerTeam - { id, name }
   * @param {Object} params.loserTeam - { id, name }
   * @param {number} params.winnerScore
   * @param {number} params.loserScore
   * @param {string} params.gameDate
   * @returns {Object} News event object
   */
  static createBlowoutNews({ winnerTeam, loserTeam, winnerScore, loserScore, gameDate }) {
    const margin = winnerScore - loserScore
    const headlines = [
      `${winnerTeam.name} cruises past ${loserTeam.name} by ${margin}`,
      `${winnerTeam.name} dominates ${loserTeam.name} in lopsided affair`,
      `${loserTeam.name} never stood a chance as ${winnerTeam.name} rolls`,
    ]

    const headline = headlines[Math.floor(Math.random() * headlines.length)]

    return {
      teamId: winnerTeam.id ?? null,
      eventType: 'general',
      headline,
      body: `The ${winnerTeam.name} blew out the ${loserTeam.name} ${winnerScore}-${loserScore} in a dominant performance.`,
      gameDate,
    }
  }

  /**
   * Create news for a standout individual performance.
   *
   * @param {Object} params
   * @param {Object} params.player - { id, firstName/first_name, lastName/last_name }
   * @param {Object} params.team - { id, name }
   * @param {Object} params.opponent - { id, name }
   * @param {Object} params.stats - { points, rebounds, assists }
   * @param {boolean} params.teamWon
   * @param {string} params.gameDate
   * @returns {Object} News event object
   */
  static createBigPerformanceNews({ player, team, opponent, stats, teamWon, gameDate }) {
    const playerName = `${player.firstName ?? player.first_name ?? 'Unknown'} ${player.lastName ?? player.last_name ?? 'Player'}`
    const pts = stats.points ?? 0
    const reb = stats.rebounds ?? 0
    const ast = stats.assists ?? 0
    const result = teamWon ? 'win over' : 'loss to'

    const headlines = [
      `${playerName} erupts for ${pts} points in ${result} the ${opponent.name}`,
      `${playerName} goes off! ${pts} pts, ${reb} reb, ${ast} ast`,
      `Monster game: ${playerName} puts up ${pts}/${reb}/${ast} stat line`,
    ]

    const headline = headlines[Math.floor(Math.random() * headlines.length)]

    return {
      playerId: NewsService._resolvePlayerId(player),
      teamId: team.id ?? null,
      eventType: 'big_performance',
      headline,
      body: `${playerName} had a standout performance with ${pts} points, ${reb} rebounds, and ${ast} assists in the ${team.name}'s ${result} the ${opponent.name}.`,
      gameDate,
    }
  }

  /**
   * Create news for a milestone achievement.
   *
   * @param {Object} params
   * @param {Object} params.player - { id, firstName/first_name, lastName/last_name }
   * @param {Object} params.team - { id, name }
   * @param {string} params.milestone - Description of milestone
   * @param {string} params.gameDate
   * @returns {Object} News event object
   */
  static createMilestoneNews({ player, team, milestone, gameDate }) {
    const playerName = `${player.firstName ?? player.first_name ?? 'Unknown'} ${player.lastName ?? player.last_name ?? 'Player'}`

    return {
      playerId: NewsService._resolvePlayerId(player),
      teamId: team.id ?? null,
      eventType: 'milestone',
      headline: `${playerName} reaches milestone: ${milestone}`,
      body: `${playerName} of the ${team.name} has achieved a milestone: ${milestone}.`,
      gameDate,
    }
  }

  /**
   * Create news for a win/loss streak.
   *
   * @param {Object} params
   * @param {Object} params.team - { id, name }
   * @param {number} params.streakCount
   * @param {boolean} params.isWinStreak
   * @param {string} params.gameDate
   * @returns {Object} News event object
   */
  static createStreakNews({ team, streakCount, isWinStreak, gameDate }) {
    const streakType = isWinStreak ? 'winning' : 'losing'

    const headlines = isWinStreak
      ? [
        `${team.name} extend ${streakType} streak to ${streakCount} games`,
        `Red hot! ${team.name} make it ${streakCount} wins in a row`,
        `${team.name} can't be stopped: ${streakCount}-game win streak`,
      ]
      : [
        `${team.name} drop ${streakCount} straight`,
        `${team.name}'s ${streakType} streak reaches ${streakCount} games`,
        `Tough times: ${team.name} lose ${streakCount} in a row`,
      ]

    const headline = headlines[Math.floor(Math.random() * headlines.length)]

    return {
      teamId: team.id ?? null,
      eventType: 'streak',
      headline,
      body: `The ${team.name} have ${isWinStreak ? 'won' : 'lost'} ${streakCount} games in a row.`,
      gameDate,
    }
  }

  /**
   * Resolve a player ID for a news event. Returns the id as-is (string or number).
   * In the client-side version, we don't need to verify DB existence.
   * @private
   */
  static _resolvePlayerId(player) {
    const id = player.id ?? null
    return id != null ? id : null
  }
}

export default NewsService
