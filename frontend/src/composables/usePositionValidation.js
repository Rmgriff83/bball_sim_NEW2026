/**
 * Composable for position validation in lineup selection.
 * Players can only be placed in positions matching their primary or secondary position.
 */
export function usePositionValidation() {
  const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

  /**
   * Check if a player can play a specific position.
   * @param {Object} player - Player object with position and secondary_position/secondaryPosition
   * @param {string} position - Position to check (PG, SG, SF, PF, C)
   * @returns {boolean}
   */
  function canPlayPosition(player, position) {
    // Handle both snake_case and camelCase field names
    const secondary = player.secondary_position || player.secondaryPosition
    return player.position === position || secondary === position
  }

  /**
   * Get all positions a player can play.
   * @param {Object} player - Player object
   * @returns {string[]} Array of positions
   */
  function getPlayablePositions(player) {
    const positions = [player.position]
    const secondary = player.secondary_position || player.secondaryPosition
    if (secondary && secondary !== player.position) {
      positions.push(secondary)
    }
    return positions
  }

  /**
   * Filter players eligible for a specific position slot.
   * @param {Array} players - Array of player objects
   * @param {string} position - Position to filter for
   * @param {Array} excludeIds - Player IDs to exclude (already selected elsewhere)
   * @returns {Array} Filtered players
   */
  function getEligiblePlayers(players, position, excludeIds = []) {
    return players.filter(p => {
      // Handle both id and player_id field names
      const playerId = p.id || p.player_id
      return canPlayPosition(p, position) && !excludeIds.includes(playerId)
    })
  }

  /**
   * Validate a complete 5-player lineup for position requirements.
   * @param {Array} players - All available players
   * @param {Array} lineupIds - Array of 5 player IDs in position order [PG, SG, SF, PF, C]
   * @returns {{ valid: boolean, errors: Array }}
   */
  function validateLineup(players, lineupIds) {
    const errors = []

    // Create player map for quick lookup
    const playerMap = {}
    players.forEach(p => {
      const id = p.id || p.player_id
      playerMap[id] = p
    })

    POSITIONS.forEach((pos, index) => {
      const playerId = lineupIds[index]

      if (!playerId) {
        errors.push({ position: pos, error: `No player selected for ${pos}` })
        return
      }

      const player = playerMap[playerId]
      if (!player) {
        errors.push({ position: pos, error: 'Player not found' })
        return
      }

      if (!canPlayPosition(player, pos)) {
        const name = player.name || `${player.first_name} ${player.last_name}`
        errors.push({
          position: pos,
          error: `${name} cannot play ${pos}`,
          player
        })
      }
    })

    return { valid: errors.length === 0, errors }
  }

  return {
    POSITIONS,
    canPlayPosition,
    getPlayablePositions,
    getEligiblePlayers,
    validateLineup
  }
}
