// ---------------------------------------------------------------------------
// NewsService
// ---------------------------------------------------------------------------
// Generates game news events based on game results and notable performances.
// All data is passed in and returned as plain objects — no database access.
// Each method returns a news event object that the caller can persist.
//
// Every headline/body is built via T() (commentaryTemplate.js) so news
// records carry `headline_tpl`/`headline_params` and `body_tpl`/`body_params`
// alongside the unchanged English `headline`/`body` — the UI translates via
// $tDynamic(tpl, params) with fallback to the stored English string.
// ---------------------------------------------------------------------------

import { T } from '../simulation/commentaryTemplate'

// --- News headline template pools -------------------------------------------
// Every entry is a translation TEMPLATE ({token} placeholders, no player/team
// names baked in) interpolated via T() after a variant is picked. The `*_TPLS`
// naming is load-bearing: wl-i18n.config.js regex-extracts the quoted strings
// of these const blocks (plus direct quoted first args of T calls).

const GAME_WINNER_HEADLINE_TPLS = [
  '{player} hits game-winner! {winner} defeats {loser}',
  'Clutch! {player} lifts {winner} to victory',
  "{player}'s {shotType} sinks {loser} at the buzzer",
]

const BLOWOUT_HEADLINE_TPLS = [
  '{winner} cruises past {loser} by {margin}',
  '{winner} dominates {loser} in lopsided affair',
  '{loser} never stood a chance as {winner} rolls',
]

// Win/loss variants are separate complete templates (the result phrase is
// part of the sentence, never a concatenated fragment).
const BIG_PERFORMANCE_WIN_HEADLINE_TPLS = [
  '{player} erupts for {pts} points in win over the {opponent}',
  '{player} goes off! {pts} pts, {reb} reb, {ast} ast',
  'Monster game: {player} puts up {pts}/{reb}/{ast} stat line',
]
const BIG_PERFORMANCE_LOSS_HEADLINE_TPLS = [
  '{player} erupts for {pts} points in loss to the {opponent}',
  '{player} goes off! {pts} pts, {reb} reb, {ast} ast',
  'Monster game: {player} puts up {pts}/{reb}/{ast} stat line',
]

const WIN_STREAK_HEADLINE_TPLS = [
  '{team} extend winning streak to {n} games',
  'Red hot! {team} make it {n} wins in a row',
  "{team} can't be stopped: {n}-game win streak",
]
const LOSS_STREAK_HEADLINE_TPLS = [
  '{team} drop {n} straight',
  "{team}'s losing streak reaches {n} games",
  'Tough times: {team} lose {n} in a row',
]

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

    const headlineTpl = GAME_WINNER_HEADLINE_TPLS[Math.floor(Math.random() * GAME_WINNER_HEADLINE_TPLS.length)]
    const headline = T(headlineTpl, { player: playerName, winner: winningTeam, loser: losingTeam, shotType })
    const body = T('{player} hit a clutch {shotType} to give the {winner} a {homeScore}-{awayScore} victory over the {loser}.', {
      player: playerName, shotType, winner: winningTeam, homeScore, awayScore, loser: losingTeam,
    })

    return {
      playerId: NewsService._resolvePlayerId(player),
      teamId: isHomeTeam ? (homeTeam.id ?? null) : (awayTeam.id ?? null),
      eventType: 'game_winner',
      headline: headline.text,
      body: body.text,
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
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

    const headline = overtimePeriods > 1
      ? T('{winner} outlasts {loser} in {n}OT thriller', { winner, loser, n: overtimePeriods })
      : T('{winner} outlasts {loser} in OT thriller', { winner, loser })
    const body = T('In an instant classic, the {winner} defeated the {loser} {homeScore}-{awayScore} after {n} overtime period(s).', {
      winner, loser, homeScore, awayScore, n: overtimePeriods,
    })

    return {
      teamId: homeScore > awayScore ? (homeTeam.id ?? null) : (awayTeam.id ?? null),
      eventType: 'general',
      headline: headline.text,
      body: body.text,
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
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

    const headlineTpl = BLOWOUT_HEADLINE_TPLS[Math.floor(Math.random() * BLOWOUT_HEADLINE_TPLS.length)]
    const headline = T(headlineTpl, { winner: winnerTeam.name, loser: loserTeam.name, margin })
    const body = T('The {winner} blew out the {loser} {winnerScore}-{loserScore} in a dominant performance.', {
      winner: winnerTeam.name, loser: loserTeam.name, winnerScore, loserScore,
    })

    return {
      teamId: winnerTeam.id ?? null,
      eventType: 'general',
      headline: headline.text,
      body: body.text,
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
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

    const pool = teamWon ? BIG_PERFORMANCE_WIN_HEADLINE_TPLS : BIG_PERFORMANCE_LOSS_HEADLINE_TPLS
    const headlineTpl = pool[Math.floor(Math.random() * pool.length)]
    const headline = T(headlineTpl, { player: playerName, pts, reb, ast, opponent: opponent.name })
    const body = teamWon
      ? T("{player} had a standout performance with {pts} points, {reb} rebounds, and {ast} assists in the {team}'s win over the {opponent}.", {
        player: playerName, pts, reb, ast, team: team.name, opponent: opponent.name,
      })
      : T("{player} had a standout performance with {pts} points, {reb} rebounds, and {ast} assists in the {team}'s loss to the {opponent}.", {
        player: playerName, pts, reb, ast, team: team.name, opponent: opponent.name,
      })

    return {
      playerId: NewsService._resolvePlayerId(player),
      teamId: team.id ?? null,
      eventType: 'big_performance',
      headline: headline.text,
      body: body.text,
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
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

    const headline = T('{player} reaches milestone: {milestone}', { player: playerName, milestone })
    const body = T('{player} of the {team} has achieved a milestone: {milestone}.', {
      player: playerName, team: team.name, milestone,
    })

    return {
      playerId: NewsService._resolvePlayerId(player),
      teamId: team.id ?? null,
      eventType: 'milestone',
      headline: headline.text,
      body: body.text,
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
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
    const pool = isWinStreak ? WIN_STREAK_HEADLINE_TPLS : LOSS_STREAK_HEADLINE_TPLS
    const headlineTpl = pool[Math.floor(Math.random() * pool.length)]
    const headline = T(headlineTpl, { team: team.name, n: streakCount })
    const body = isWinStreak
      ? T('The {team} have won {n} games in a row.', { team: team.name, n: streakCount })
      : T('The {team} have lost {n} games in a row.', { team: team.name, n: streakCount })

    return {
      teamId: team.id ?? null,
      eventType: 'streak',
      headline: headline.text,
      body: body.text,
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
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
