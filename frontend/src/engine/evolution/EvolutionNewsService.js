/**
 * EvolutionNewsService
 *
 * Generates news-event objects for player evolution milestones:
 * injuries, recoveries, hot/cold streaks, development, breakouts,
 * decline, trade requests, and retirements.
 *
 * Translated from backend EvolutionNewsService.php.
 * Instead of persisting to a database, every method returns a plain
 * news-event object that the caller can store as needed.
 *
 * All game logic and text templates are preserved exactly.
 *
 * Every headline/body is built via T() (commentaryTemplate.js) so news
 * records carry `headline_tpl`/`headline_params` and `body_tpl`/`body_params`
 * alongside the unchanged English `headline`/`body` — the UI translates via
 * $tDynamic(tpl, params) with fallback to the stored English string.
 */

import { T } from '../simulation/commentaryTemplate'

// --- Headline template pools -------------------------------------------------
// Every entry is a translation TEMPLATE ({token} placeholders, no player
// names baked in) interpolated via T() after a variant is picked. The `*_TPLS`
// naming is load-bearing: wl-i18n.config.js regex-extracts the quoted strings
// of these const blocks (plus direct quoted first args of T calls).

const INJURY_HEADLINE_TPLS = [
  '{player} suffers {injury}, out {estimate}',
  'Injury report: {player} sidelined with {injury}',
  '{player} to miss time with {injury}',
]

const RECOVERY_HEADLINE_TPLS = [
  '{player} cleared to return from {injury}',
  '{player} back in action after recovering from {injury}',
  'Good news: {player} healthy and ready to play',
]

const HOT_STREAK_HEADLINE_TPLS = [
  '{player} is on fire!',
  '{player} continues red-hot stretch',
  'Unstoppable: {player} extends hot streak to {games} games',
]

const COLD_STREAK_HEADLINE_TPLS = [
  '{player} struggling through slump',
  '{player} mired in {games}-game cold stretch',
  'Concerns mount as {player} continues to struggle',
]

const DEVELOPMENT_HEADLINE_TPLS = [
  '{player} showing improvement in {attr}',
  "Development report: {player}'s {attr} on the rise",
  '{player} making strides with {attr}',
]

const BREAKOUT_HEADLINE_TPLS = [
  'Breakout alert: {player} emerging as a star',
  '{player} taking a major leap forward',
  'Rising star: {player} making a name for themselves',
]

const DECLINE_HEADLINE_TPLS = [
  'Father Time catching up with {player}',
  '{player} showing signs of age',
  'Veteran {player} slowing down',
]

const TRADE_REQUEST_HEADLINE_TPLS = [
  '{player} requests trade',
  'Unhappy {player} wants out',
  'Trade demand: {player} asks to be moved',
]

const RETIREMENT_HEADLINE_TPLS = [
  '{player} announces retirement after {seasons} seasons',
  'End of an era: {player} calls it a career',
  '{player} hangs up the sneakers after {seasons} years',
]

export class EvolutionNewsService {

  // ---------------------------------------------------------------------------
  // Injury & Recovery
  // ---------------------------------------------------------------------------

  /**
   * Create news event for player injury.
   * @param {Object} campaign - Campaign context with { id, current_date }
   * @param {Object} player
   * @param {Object} injury - { name, days_remaining } (legacy: games_remaining)
   * @returns {Object} news event
   */
  createInjuryNews (campaign, player, injury) {
    const playerName = this._getPlayerName(player)
    const injuryName = injury.name ?? 'injury'
    const estimate = this._getRecoveryEstimate(injury.days_remaining ?? injury.games_remaining ?? 0)

    const headlineTpl = INJURY_HEADLINE_TPLS[Math.floor(Math.random() * INJURY_HEADLINE_TPLS.length)]
    const headline = T(headlineTpl, { player: playerName, injury: injuryName, estimate })
    const body = T('{player} has been diagnosed with a {injury} and is expected to be out {estimate}.', {
      player: playerName, injury: injuryName, estimate,
    })

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'injury',
      headline: headline.text,
      body: body.text,
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
      game_date: campaign.current_date,
    }
  }

  /**
   * Create news event for player recovery.
   * @param {Object} campaign
   * @param {Object} player
   * @param {Object} injury - { name }
   * @returns {Object}
   */
  createRecoveryNews (campaign, player, injury) {
    const playerName = this._getPlayerName(player)
    const injuryName = injury.name ?? 'injury'

    const headlineTpl = RECOVERY_HEADLINE_TPLS[Math.floor(Math.random() * RECOVERY_HEADLINE_TPLS.length)]
    const headline = T(headlineTpl, { player: playerName, injury: injuryName })
    const body = T('{player} has fully recovered and has been cleared to return to game action.', {
      player: playerName,
    })

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'recovery',
      headline: headline.text,
      body: body.text,
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
      game_date: campaign.current_date,
    }
  }

  // ---------------------------------------------------------------------------
  // Streaks
  // ---------------------------------------------------------------------------

  /**
   * Create news event for hot streak.
   * @param {Object} campaign
   * @param {Object} player
   * @param {number} games
   * @param {Object} attributeBoosts - e.g. { 'offense.threePoint': 2 }
   * @returns {Object}
   */
  createHotStreakNews (campaign, player, games, attributeBoosts) {
    const playerName = this._getPlayerName(player)
    const boostList = this._formatBoostList(attributeBoosts)

    const headlineTpl = HOT_STREAK_HEADLINE_TPLS[Math.floor(Math.random() * HOT_STREAK_HEADLINE_TPLS.length)]
    const headline = T(headlineTpl, { player: playerName, games })
    // The boost sentence is a separate complete template branch — never a
    // concatenated fragment. (The no-boost variant keeps the historical
    // trailing space so English output stays byte-identical.)
    const body = boostList
      ? T('{player} has been playing at an elite level over the past {games} games. Their {boosts} ratings have improved.', {
        player: playerName, games, boosts: boostList,
      })
      : T('{player} has been playing at an elite level over the past {games} games. ', {
        player: playerName, games,
      })

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'hot_streak',
      headline: headline.text,
      body: body.text,
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
      game_date: campaign.current_date,
    }
  }

  /**
   * Create news event for cold streak.
   * @param {Object} campaign
   * @param {Object} player
   * @param {number} games
   * @returns {Object}
   */
  createColdStreakNews (campaign, player, games) {
    const playerName = this._getPlayerName(player)

    const headlineTpl = COLD_STREAK_HEADLINE_TPLS[Math.floor(Math.random() * COLD_STREAK_HEADLINE_TPLS.length)]
    const headline = T(headlineTpl, { player: playerName, games })
    const body = T('{player} has been struggling over the past {games} games and is looking to break out of the slump.', {
      player: playerName, games,
    })

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'cold_streak',
      headline: headline.text,
      body: body.text,
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
      game_date: campaign.current_date,
    }
  }

  // ---------------------------------------------------------------------------
  // Development & Rating Changes
  // ---------------------------------------------------------------------------

  /**
   * Create news event for development milestone.
   * @param {Object} campaign
   * @param {Object} player
   * @param {string} attribute - e.g. 'offense.threePoint'
   * @param {number} increase
   * @returns {Object}
   */
  createDevelopmentNews (campaign, player, attribute, increase) {
    const playerName = this._getPlayerName(player)
    const attrName = this._formatAttributeName(attribute)

    const headlineTpl = DEVELOPMENT_HEADLINE_TPLS[Math.floor(Math.random() * DEVELOPMENT_HEADLINE_TPLS.length)]
    const headline = T(headlineTpl, { player: playerName, attr: attrName })
    const body = T('{player} has been working hard and showing noticeable improvement in {attr}.', {
      player: playerName, attr: attrName,
    })

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'development',
      headline: headline.text,
      body: body.text,
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
      game_date: campaign.current_date,
    }
  }

  /**
   * Create news event for breakout performance.
   * @param {Object} campaign
   * @param {Object} player
   * @param {number} overallGain
   * @returns {Object}
   */
  createBreakoutNews (campaign, player, overallGain) {
    const playerName = this._getPlayerName(player)
    const age = player.age ?? 22

    const headlineTpl = BREAKOUT_HEADLINE_TPLS[Math.floor(Math.random() * BREAKOUT_HEADLINE_TPLS.length)]
    const headline = T(headlineTpl, { player: playerName })
    const body = T('At just {age} years old, {player} has shown tremendous growth this month, improving their overall rating by {gain} points.', {
      age, player: playerName, gain: overallGain,
    })

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'breakout',
      headline: headline.text,
      body: body.text,
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
      game_date: campaign.current_date,
    }
  }

  /**
   * Create news event for veteran decline.
   * @param {Object} campaign
   * @param {Object} player
   * @param {number} overallLoss
   * @returns {Object}
   */
  createDeclineNews (campaign, player, overallLoss) {
    const playerName = this._getPlayerName(player)
    const age = player.age ?? 35

    const headlineTpl = DECLINE_HEADLINE_TPLS[Math.floor(Math.random() * DECLINE_HEADLINE_TPLS.length)]
    const headline = T(headlineTpl, { player: playerName })
    const body = T("At {age} years old, {player} appears to be losing a step. The veteran's overall rating has dropped by {loss} points this month.", {
      age, player: playerName, loss: overallLoss,
    })

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'decline',
      headline: headline.text,
      body: body.text,
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
      game_date: campaign.current_date,
    }
  }

  // ---------------------------------------------------------------------------
  // Roster / Career Events
  // ---------------------------------------------------------------------------

  /**
   * Create news event for trade request.
   * @param {Object} campaign
   * @param {Object} player
   * @returns {Object}
   */
  createTradeRequestNews (campaign, player) {
    const playerName = this._getPlayerName(player)

    const headlineTpl = TRADE_REQUEST_HEADLINE_TPLS[Math.floor(Math.random() * TRADE_REQUEST_HEADLINE_TPLS.length)]
    const headline = T(headlineTpl, { player: playerName })
    const body = T('{player} has formally requested a trade, citing dissatisfaction with their current situation.', {
      player: playerName,
    })

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'trade_request',
      headline: headline.text,
      body: body.text,
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
      game_date: campaign.current_date,
    }
  }

  /**
   * Create news event for retirement.
   * @param {Object} campaign
   * @param {Object} player
   * @param {number} careerSeasons
   * @returns {Object}
   */
  createRetirementNews (campaign, player, careerSeasons) {
    const playerName = this._getPlayerName(player)

    const headlineTpl = RETIREMENT_HEADLINE_TPLS[Math.floor(Math.random() * RETIREMENT_HEADLINE_TPLS.length)]
    const headline = T(headlineTpl, { player: playerName, seasons: careerSeasons })
    const body = T('{player} has announced their retirement after a {seasons}-year career in the league.', {
      player: playerName, seasons: careerSeasons,
    })

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'retirement',
      headline: headline.text,
      body: body.text,
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
      game_date: campaign.current_date,
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Get player name from player object.
   * @param {Object} player
   * @returns {string}
   * @private
   */
  _getPlayerName (player) {
    const first = player.firstName ?? player.first_name ?? 'Unknown'
    const last = player.lastName ?? player.last_name ?? 'Player'
    return `${first} ${last}`
  }

  /**
   * Get player ID.
   * Client-side we simply return whatever id the player object carries.
   * @param {Object} player
   * @returns {string|number|null}
   * @private
   */
  _getPlayerId (player) {
    return player.id ?? null
  }

  /**
   * Get team ID.
   * Returns the team_id or teamAbbreviation from the player object.
   * @param {Object} player
   * @returns {string|number|null}
   * @private
   */
  _getTeamId (player) {
    return player.team_id ?? player.teamId ?? player.teamAbbreviation ?? null
  }

  /**
   * Get human-readable recovery estimate. Input is days remaining (the
   * canonical injury timer post games→days migration).
   * @param {number} days
   * @returns {string}
   * @private
   */
  _getRecoveryEstimate (days) {
    if (days <= 7) return 'day-to-day'
    if (days <= 21) return '1-3 weeks'
    if (days <= 45) return '3-6 weeks'
    if (days <= 90) return '6-13 weeks'
    if (days <= 150) return '3-5 months'
    return 'for the season'
  }

  /**
   * Format the attribute-boost list for the hot-streak body template
   * (e.g. "+2 three point, +1 speed"). Returns '' when there are no boosts.
   * @param {Object} boosts - e.g. { 'threePoint': 2, 'speed': 1 }
   * @returns {string}
   * @private
   */
  _formatBoostList (boosts) {
    if (!boosts || Object.keys(boosts).length === 0) {
      return ''
    }

    const parts = []
    for (const [attr, value] of Object.entries(boosts)) {
      const name = this._formatAttributeName(attr)
      parts.push(`+${value} ${name}`)
    }

    return parts.join(', ')
  }

  /**
   * Format attribute name for display.
   * Handles nested attributes like 'offense.threePoint' and converts
   * camelCase to lowercase spaced words.
   * @param {string} attribute
   * @returns {string}
   * @private
   */
  _formatAttributeName (attribute) {
    // Handle nested attributes like "offense.threePoint"
    if (attribute.includes('.')) {
      attribute = attribute.split('.')[1]
    }

    // Convert camelCase to words
    const words = attribute.replace(/([a-z])([A-Z])/g, '$1 $2')
    return words.toLowerCase()
  }
}

export default EvolutionNewsService
