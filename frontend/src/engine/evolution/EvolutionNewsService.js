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
 */
export class EvolutionNewsService {

  // ---------------------------------------------------------------------------
  // Injury & Recovery
  // ---------------------------------------------------------------------------

  /**
   * Create news event for player injury.
   * @param {Object} campaign - Campaign context with { id, current_date }
   * @param {Object} player
   * @param {Object} injury - { name, games_remaining }
   * @returns {Object} news event
   */
  createInjuryNews (campaign, player, injury) {
    const playerName = this._getPlayerName(player)
    const injuryName = injury.name ?? 'injury'
    const estimate = this._getRecoveryEstimate(injury.games_remaining ?? 0)

    const headlines = [
      `${playerName} suffers ${injuryName}, out ${estimate}`,
      `Injury report: ${playerName} sidelined with ${injuryName}`,
      `${playerName} to miss time with ${injuryName}`,
    ]

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'injury',
      headline: headlines[Math.floor(Math.random() * headlines.length)],
      body: `${playerName} has been diagnosed with a ${injuryName} and is expected to be out ${estimate}.`,
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

    const headlines = [
      `${playerName} cleared to return from ${injuryName}`,
      `${playerName} back in action after recovering from ${injuryName}`,
      `Good news: ${playerName} healthy and ready to play`,
    ]

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'recovery',
      headline: headlines[Math.floor(Math.random() * headlines.length)],
      body: `${playerName} has fully recovered and has been cleared to return to game action.`,
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
    const boostText = this._formatAttributeBoosts(attributeBoosts)

    const headlines = [
      `${playerName} is on fire!`,
      `${playerName} continues red-hot stretch`,
      `Unstoppable: ${playerName} extends hot streak to ${games} games`,
    ]

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'hot_streak',
      headline: headlines[Math.floor(Math.random() * headlines.length)],
      body: `${playerName} has been playing at an elite level over the past ${games} games. ${boostText}`,
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

    const headlines = [
      `${playerName} struggling through slump`,
      `${playerName} mired in ${games}-game cold stretch`,
      `Concerns mount as ${playerName} continues to struggle`,
    ]

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'cold_streak',
      headline: headlines[Math.floor(Math.random() * headlines.length)],
      body: `${playerName} has been struggling over the past ${games} games and is looking to break out of the slump.`,
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

    const headlines = [
      `${playerName} showing improvement in ${attrName}`,
      `Development report: ${playerName}'s ${attrName} on the rise`,
      `${playerName} making strides with ${attrName}`,
    ]

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'development',
      headline: headlines[Math.floor(Math.random() * headlines.length)],
      body: `${playerName} has been working hard and showing noticeable improvement in ${attrName}.`,
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

    const headlines = [
      `Breakout alert: ${playerName} emerging as a star`,
      `${playerName} taking a major leap forward`,
      `Rising star: ${playerName} making a name for themselves`,
    ]

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'breakout',
      headline: headlines[Math.floor(Math.random() * headlines.length)],
      body: `At just ${age} years old, ${playerName} has shown tremendous growth this month, improving their overall rating by ${overallGain} points.`,
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

    const headlines = [
      `Father Time catching up with ${playerName}`,
      `${playerName} showing signs of age`,
      `Veteran ${playerName} slowing down`,
    ]

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'decline',
      headline: headlines[Math.floor(Math.random() * headlines.length)],
      body: `At ${age} years old, ${playerName} appears to be losing a step. The veteran's overall rating has dropped by ${overallLoss} points this month.`,
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

    const headlines = [
      `${playerName} requests trade`,
      `Unhappy ${playerName} wants out`,
      `Trade demand: ${playerName} asks to be moved`,
    ]

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'trade_request',
      headline: headlines[Math.floor(Math.random() * headlines.length)],
      body: `${playerName} has formally requested a trade, citing dissatisfaction with their current situation.`,
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

    const headlines = [
      `${playerName} announces retirement after ${careerSeasons} seasons`,
      `End of an era: ${playerName} calls it a career`,
      `${playerName} hangs up the sneakers after ${careerSeasons} years`,
    ]

    return {
      campaign_id: campaign.id,
      player_id: this._getPlayerId(player),
      team_id: this._getTeamId(player),
      event_type: 'retirement',
      headline: headlines[Math.floor(Math.random() * headlines.length)],
      body: `${playerName} has announced their retirement after a ${careerSeasons}-year career in the league.`,
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
   * Get human-readable recovery estimate.
   * @param {number} games
   * @returns {string}
   * @private
   */
  _getRecoveryEstimate (games) {
    if (games <= 5) return 'day-to-day'
    if (games <= 14) return '1-2 weeks'
    if (games <= 28) return '2-4 weeks'
    if (games <= 42) return '4-6 weeks'
    if (games <= 60) return '6-8 weeks'
    return 'for the season'
  }

  /**
   * Format attribute boosts for news content.
   * @param {Object} boosts - e.g. { 'threePoint': 2, 'speed': 1 }
   * @returns {string}
   * @private
   */
  _formatAttributeBoosts (boosts) {
    if (!boosts || Object.keys(boosts).length === 0) {
      return ''
    }

    const parts = []
    for (const [attr, value] of Object.entries(boosts)) {
      const name = this._formatAttributeName(attr)
      parts.push(`+${value} ${name}`)
    }

    return 'Their ' + parts.join(', ') + ' ratings have improved.'
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
